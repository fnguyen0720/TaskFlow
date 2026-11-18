using System.Net;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace TaskFlow.Api.Tests;

public sealed class AuthClientIpPartitionTests
{
    private static DefaultHttpContext Context(string peer = "10.0.0.10")
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        return context;
    }

    [Fact]
    public void WithoutExplicitTrust_IgnoreAllForwardedClientHeaders()
    {
        var request = Context();
        request.Request.Headers["CF-Connecting-IP"] = "198.51.100.50";
        request.Request.Headers["X-Forwarded-For"] = "203.0.113.100";

        Assert.Equal("peer:10.0.0.10", AuthClientIpPartition.GetKey(request, false));
    }

    [Fact]
    public void TrustedEdge_DifferentClientsBehindSameProxyHaveDistinctBuckets()
    {
        var clientA = Context();
        var clientB = Context();
        clientA.Request.Headers["CF-Connecting-IP"] = "198.51.100.50";
        clientB.Request.Headers["CF-Connecting-IP"] = "198.51.100.51";

        Assert.Equal("edge:198.51.100.50", AuthClientIpPartition.GetKey(clientA, true));
        Assert.Equal("edge:198.51.100.51", AuthClientIpPartition.GetKey(clientB, true));
        Assert.NotEqual(
            AuthClientIpPartition.GetKey(clientA, true),
            AuthClientIpPartition.GetKey(clientB, true));
    }

    [Fact]
    public void TrustedEdge_SpoofedXForwardedForCannotChangeBucket()
    {
        var context = Context();
        context.Request.Headers["CF-Connecting-IP"] = "198.51.100.50";
        var before = AuthClientIpPartition.GetKey(context, true);

        context.Request.Headers["X-Forwarded-For"] = "192.0.2.99, 192.0.2.100";
        Assert.Equal(before, AuthClientIpPartition.GetKey(context, true));

        context.Request.Headers["X-Forwarded-For"] = "not-an-ip";
        Assert.Equal(before, AuthClientIpPartition.GetKey(context, true));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-ip")]
    [InlineData("198.51.100.50, 203.0.113.21")]
    [InlineData("198.51.100.50; 203.0.113.21")]
    [InlineData("127.0.0.1")]
    [InlineData("0.0.0.0")]
    [InlineData("::1")]
    public void InvalidOrMissingEdgeIp_FallsBackToConnection(string value)
    {
        var context = Context();
        context.Request.Headers["CF-Connecting-IP"] = value;

        Assert.Equal("peer:10.0.0.10", AuthClientIpPartition.GetKey(context, true));
    }

    [Fact]
    public void DuplicateEdgeHeaderValues_AreNotAccepted()
    {
        var context = Context();
        context.Request.Headers.Append("CF-Connecting-IP", "198.51.100.50");
        context.Request.Headers.Append("CF-Connecting-IP", "198.51.100.51");

        Assert.Equal("peer:10.0.0.10", AuthClientIpPartition.GetKey(context, true));
    }

    [Fact]
    public void MissingRemoteAddress_FailsClosedToSharedUnknownBucket()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["CF-Connecting-IP"] = "198.51.100.50";
        Assert.Equal("peer:unknown", AuthClientIpPartition.GetKey(context, false));
    }

    [Fact]
    public void IPv4MappedIpv6_NormalizesToSameBucket()
    {
        var context = Context("::ffff:10.0.0.10");
        Assert.Equal("peer:10.0.0.10", AuthClientIpPartition.GetKey(context, false));

        context.Request.Headers["CF-Connecting-IP"] = "::ffff:198.51.100.50";
        Assert.Equal("edge:198.51.100.50", AuthClientIpPartition.GetKey(context, true));
    }

    [Fact]
    public void DiagnosticTagsAreStableButDoNotRevealRawAddresses()
    {
        const string key = "edge:198.51.100.50";
        var tag = AuthClientIpPartition.DiagnosticTag(key);
        Assert.Equal(20, tag.Length);
        Assert.Equal(tag, AuthClientIpPartition.DiagnosticTag(key));
        Assert.NotEqual(tag, AuthClientIpPartition.DiagnosticTag("edge:198.51.100.51"));
        Assert.DoesNotContain("198.51.100", tag);
    }
}
