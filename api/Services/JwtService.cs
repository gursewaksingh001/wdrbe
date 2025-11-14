using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using AWS.Lambda.Powertools.Logging;
using Microsoft.IdentityModel.Tokens;

namespace WardrobeItems.Api.Services;

public class JwtService : IJwtService
{
    private readonly string _secretParameterName;
    private readonly IAmazonSimpleSystemsManagement _ssm;
    private string? _cachedSecret;
    private DateTime _cacheExpiry = DateTime.MinValue;

    public JwtService(string secretParameterName, IAmazonSimpleSystemsManagement? ssm = null)
    {
        _secretParameterName = secretParameterName;
        _ssm = ssm ?? new AmazonSimpleSystemsManagementClient();
    }

    public async Task<string> GetSecretAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedSecret is not null && DateTime.UtcNow < _cacheExpiry)
        {
            return _cachedSecret;
        }

        var response = await _ssm.GetParameterAsync(new GetParameterRequest
        {
            Name = _secretParameterName,
            WithDecryption = true
        }, cancellationToken);

        _cachedSecret = response.Parameter.Value;
        _cacheExpiry = DateTime.UtcNow.AddMinutes(5);
        return _cachedSecret;
    }

    public (bool IsValid, string? UserId, string? ErrorMessage) ValidateToken(string token, string secret)
    {
        try
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            tokenHandler.InboundClaimTypeMap.Clear();
            tokenHandler.OutboundClaimTypeMap.Clear();
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(2)
            };

            var principal = tokenHandler.ValidateToken(token, validationParameters, out _);
            var userId = principal.FindFirst("sub")?.Value
                         ?? principal.FindFirst("userId")?.Value
                         ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;

            if (string.IsNullOrEmpty(userId))
            {
                return (false, null, "token missing sub claim");
            }

            return (true, userId, null);
        }
        catch (SecurityTokenExpiredException)
        {
            return (false, null, "token expired");
        }
        catch (SecurityTokenInvalidSignatureException)
        {
            return (false, null, "invalid signature");
        }
        catch (Exception ex)
        {
            Logger.LogWarning("Token validation failed", new { Error = ex.Message });
            return (false, null, "token invalid");
        }
    }
}

