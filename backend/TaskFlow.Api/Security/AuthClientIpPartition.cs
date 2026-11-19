using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;

/// <summary>
/// Selects a rate-limit partition without trusting headers from arbitrary clients.
/// Render PUBLIC web services are protected by Cloudflare; Render documents that
/// Cloudflare overwrites CF-Connecting-IP for requests passing through its edge.
/// This mode is opt-in and MUST NOT be used for private services or direct access.
/// </summary>
public static class AuthClientIpPartition
{
    private static readonly byte[] DiagnosticSecret = RandomNumberGenerator.GetBytes(32);

    public static string GetKey(HttpContext context, bool trustRenderPublicEdge)
    {
        if (trustRenderPublicEdge &&
            context.Request.Headers.TryGetValue("CF-Connecting-IP", out var values) &&
            values.Count == 1 &&
            TryParseSingleIp(values[0], out var edgeIp))
        {
            return "edge:" + Normalize(edgeIp).ToString();
        }

        var peerIp = context.Connection.RemoteIpAddress;
        return peerIp is null ? "peer:unknown" : "peer:" + Normalize(peerIp).ToString();
    }

    public static string DiagnosticTag(string key)
    {
        // Per-process random HMAC key prevents reversing the diagnostic tag
        // by enumerating likely public IP addresses offline. Never log raw IPs.
        var digest = HMACSHA256.HashData(DiagnosticSecret, Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(digest.AsSpan(0, 10));
    }

    private static IPAddress Normalize(IPAddress address) =>
        address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;

    private static bool TryParseSingleIp(string? value, out IPAddress address)
    {
        address = IPAddress.None;
        if (string.IsNullOrWhiteSpace(value) ||
            value.Contains(',') ||
            value.Contains(';') ||
            !IPAddress.TryParse(value.Trim(), out var candidate) ||
            IPAddress.IsLoopback(candidate) ||
            candidate.Equals(IPAddress.Any) ||
            candidate.Equals(IPAddress.IPv6Any) ||
            candidate.Equals(IPAddress.None) ||
            candidate.Equals(IPAddress.IPv6None))
        {
            return false;
        }

        address = candidate;
        return true;
    }
}
