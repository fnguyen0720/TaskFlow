using System.Net;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;

public enum EmailDeliveryMode
{
    Disabled,
    Test,
    Live
}

public sealed class AccountEmailDelivery
{
    public EmailDeliveryMode Mode { get; }
    public bool Enabled => Mode != EmailDeliveryMode.Disabled;
    // This is the only value exposed by /api/account/capabilities.
    // Private test mode must not activate public account recovery.
    public bool PublicRecoveryEnabled => Mode == EmailDeliveryMode.Live;
    public string? ApiKey { get; }
    public string? From { get; }
    public string? ApiOrigin { get; }
    public string? FrontendOrigin { get; }
    private readonly HashSet<string> _testRecipients = new(StringComparer.OrdinalIgnoreCase);

    public AccountEmailDelivery(IConfiguration configuration)
    {
        var mode = configuration["Email:DeliveryMode"]?.Trim() ?? "Disabled";
        if (!Enum.TryParse<EmailDeliveryMode>(mode, true, out var parsed) ||
            !Enum.IsDefined(parsed))
            throw new InvalidOperationException("Email:DeliveryMode must be Disabled, Test, or Live.");
        Mode = parsed;

        var apiKey = configuration["Email:ResendApiKey"]?.Trim();
        var from = configuration["Email:FromAddress"]?.Trim();
        var api = configuration["Email:PublicApiOrigin"]?.Trim();
        var frontend = configuration["Email:FrontendOrigin"]?.Trim();
        var values = new[] { apiKey, from, api, frontend };
        var configured = values.Count(x => !string.IsNullOrWhiteSpace(x));

        // Keep the existing fail-closed rule for partially supplied secrets.
        if ((configured > 0 && configured < 4) || (Enabled && configured != 4))
            throw new InvalidOperationException("Email delivery requires all four Email settings.");
        if (!Enabled) return;

        if (!TryTrustedOrigin(api, out var apiOrigin) ||
            !TryTrustedOrigin(frontend, out var frontendOrigin) ||
            !TryValidSender(from))
            throw new InvalidOperationException("Email sender or trusted HTTPS origins are invalid.");

        if (Mode == EmailDeliveryMode.Test)
        {
            foreach (var candidate in (configuration["Email:TestRecipients"] ?? "").Split(
                         ',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            {
                if (!TryValidMailbox(candidate))
                    throw new InvalidOperationException("Email:TestRecipients contains an invalid address.");
                _testRecipients.Add(candidate);
            }
            if (_testRecipients.Count == 0)
                throw new InvalidOperationException("Test email delivery needs an explicit recipient allowlist.");
        }

        ApiKey = apiKey;
        From = from;
        ApiOrigin = apiOrigin;
        FrontendOrigin = frontendOrigin;
    }

    public bool CanDeliverTo(string email) =>
        Enabled && TryValidMailbox(email) &&
        (Mode == EmailDeliveryMode.Live || _testRecipients.Contains(email));

    private static bool TryValidMailbox(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        !value.Contains('\r') && !value.Contains('\n') &&
        MailAddress.TryCreate(value, out var mailbox) &&
        string.Equals(mailbox.Address, value, StringComparison.OrdinalIgnoreCase);

    private static bool TryValidSender(string? value) =>
        !string.IsNullOrWhiteSpace(value) && !value.Contains('\r') && !value.Contains('\n') &&
        MailAddress.TryCreate(value, out var sender) &&
        sender.Address.Contains('@');

    private static bool TryTrustedOrigin(string? value, out string origin)
    {
        origin = "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 ||
            uri.AbsolutePath != "/" || uri.Query.Length > 0 || uri.Fragment.Length > 0)
            return false;
        origin = uri.GetLeftPart(UriPartial.Authority);
        return true;
    }

    // Identity creates a URL using the inbound Host header. Never send that
    // origin to the user: preserve only the required parameters and known path.
    public string TrustedConfirmationLink(string untrustedLink)
    {
        if (!Enabled) throw new InvalidOperationException("Email delivery is unavailable.");
        if (!Uri.TryCreate(WebUtility.HtmlDecode(untrustedLink), UriKind.Absolute, out var input) ||
            input.AbsolutePath != "/confirmEmail" ||
            !input.Query.Contains("userId=", StringComparison.Ordinal) ||
            !input.Query.Contains("code=", StringComparison.Ordinal))
            throw new InvalidOperationException("Invalid email confirmation link.");
        return ApiOrigin + "/confirmEmail" + input.Query;
    }

    // The URL fragment is not sent to the frontend host in an HTTP request.
    public string ResetLink(string email, string code)
    {
        if (!Enabled) throw new InvalidOperationException("Email delivery is unavailable.");
        return FrontendOrigin + "/#resetPassword=" +
            Uri.EscapeDataString(WebUtility.HtmlDecode(code)) +
            "&email=" + Uri.EscapeDataString(email);
    }
}

public sealed class TaskFlowIdentityEmailSender : IEmailSender<ApplicationUser>
{
    private readonly HttpClient _http;
    private readonly AccountEmailDelivery _config;

    public TaskFlowIdentityEmailSender(HttpClient http, AccountEmailDelivery config)
    {
        _http = http;
        _config = config;
        _http.Timeout = TimeSpan.FromSeconds(8);
    }

    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        !_config.CanDeliverTo(email) ? Task.CompletedTask :
        DeliverAsync(email, "Confirm your TaskFlow email",
            "Confirm your TaskFlow email by opening this link:\n" +
            _config.TrustedConfirmationLink(confirmationLink) +
            "\n\nIf you did not create this account, ignore this message.");

    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        !_config.CanDeliverTo(email) ? Task.CompletedTask :
        DeliverAsync(email, "Reset your TaskFlow password",
            "You requested a password reset. Open this link to set a new password:\n" +
            _config.ResetLink(email, resetCode) +
            "\n\nIf you did not request this, ignore this message.");

    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        Task.FromException(new NotSupportedException("Use reset-code delivery."));

    private async Task DeliverAsync(string email, string subject, string body)
    {
        if (!_config.CanDeliverTo(email)) return;
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _config.ApiKey);
        // The key is deterministic for this exact message, but contains no
        // raw email address or recovery token. Resend deduplicates retries
        // bearing the same key for its 24-hour idempotency retention period.
        var payload = Encoding.UTF8.GetBytes(_config.From + "\n" +
            email.ToLowerInvariant() + "\n" + subject + "\n" + body);
        var digest = HMACSHA256.HashData(Encoding.UTF8.GetBytes(_config.ApiKey!), payload);
        request.Headers.TryAddWithoutValidation(
            "Idempotency-Key", "taskflow-" + Convert.ToHexStringLower(digest));
        request.Content = JsonContent.Create(new
        {
            from = _config.From,
            to = new[] { email },
            subject,
            text = body
        });
        using var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("Email provider rejected the request.");
    }
}
