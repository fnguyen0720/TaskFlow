using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;

public sealed class AccountEmailDelivery
{
    public bool Enabled { get; }
    public string? ApiKey { get; }
    public string? From { get; }
    public string? ApiOrigin { get; }
    public string? FrontendOrigin { get; }

    public AccountEmailDelivery(IConfiguration configuration)
    {
        var apiKey = configuration["Email:ResendApiKey"];
        var from = configuration["Email:FromAddress"];
        var api = configuration["Email:PublicApiOrigin"];
        var frontend = configuration["Email:FrontendOrigin"];

        // A partial configuration must never silently enable delivery.
        Enabled = !string.IsNullOrWhiteSpace(apiKey) &&
                  !string.IsNullOrWhiteSpace(from) &&
                  !string.IsNullOrWhiteSpace(api) &&
                  !string.IsNullOrWhiteSpace(frontend);
        if (!Enabled)
        {
            if (new[] { apiKey, from, api, frontend }.Any(x => !string.IsNullOrWhiteSpace(x)))
                throw new InvalidOperationException("Email delivery requires all four Email settings.");
            return;
        }

        if (!TryTrustedOrigin(api, out var apiOrigin) ||
            !TryTrustedOrigin(frontend, out var frontendOrigin) ||
            from!.Contains('\r') || from.Contains('\n') ||
            !from.Contains('@'))
        {
            throw new InvalidOperationException("Email sender or trusted HTTPS origins are invalid.");
        }

        ApiKey = apiKey;
        From = from;
        ApiOrigin = apiOrigin;
        FrontendOrigin = frontendOrigin;
    }

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

    // Identity generates a URL from the request Host. Re-anchor outgoing links
    // to the explicitly trusted production API host, not an attacker Host header.
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

    // Fragment tokens never reach frontend hosting logs via HTTP requests.
    public string ResetLink(string email, string code)
    {
        if (!Enabled) throw new InvalidOperationException("Email delivery is unavailable.");
        return FrontendOrigin + "/#resetPassword=" +
            Uri.EscapeDataString(WebUtility.HtmlDecode(code)) +
            "&email=" + Uri.EscapeDataString(email);
    }
}

// Identity's built-in cryptographic tokens stay within Identity; this sender
// only handles delivery. No reset tokens or email bodies are logged.
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
        DeliverAsync(email, "Confirm your TaskFlow email",
            "Confirm your TaskFlow email by opening this link:\n" +
            (_config.Enabled ? _config.TrustedConfirmationLink(confirmationLink) : "") +
            "\n\nIf you did not create this account, ignore this message.");

    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        DeliverAsync(email, "Reset your TaskFlow password",
            "You requested a password reset. Open this link to set a new password:\n" +
            (_config.Enabled ? _config.ResetLink(email, resetCode) : "") +
            "\n\nIf you did not request this, ignore this message.");

    // The built-in Identity API uses reset-code delivery, not reset-link
    // delivery. Never forward an arbitrary host-derived link.
    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        Task.FromException(new NotSupportedException("Use reset-code delivery."));

    private async Task DeliverAsync(string email, string subject, string body)
    {
        if (!_config.Enabled) return; // Disabled on production until explicitly configured.
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _config.ApiKey);
        request.Content = JsonContent.Create(new { from = _config.From, to = new[] { email }, subject, text = body });
        using var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("Email provider rejected the request.");
    }
}
