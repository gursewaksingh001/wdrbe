using WardrobeItems.Api.Services;

namespace WardrobeItems.Api.Middleware;

public class JwtValidator : IJwtValidator
{
    private readonly IJwtService _jwtService;

    public JwtValidator(IJwtService jwtService)
    {
        _jwtService = jwtService;
    }

    public async Task<AuthResult> ValidateTokenAsync(IDictionary<string, string?> headers)
    {
        if (!headers.TryGetValue("Authorization", out var authValue) &&
            !headers.TryGetValue("authorization", out authValue))
        {
            return AuthResult.Failure("missing Authorization header");
        }

        if (string.IsNullOrWhiteSpace(authValue) || !authValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return AuthResult.Failure("invalid Authorization header");
        }

        var token = authValue.Substring("Bearer ".Length).Trim();
        if (string.IsNullOrEmpty(token))
        {
            return AuthResult.Failure("token missing");
        }

        var secret = await _jwtService.GetSecretAsync();
        var (isValid, userId, errorMessage) = _jwtService.ValidateToken(token, secret);
        return isValid && userId is not null ? AuthResult.Success(userId) : AuthResult.Failure(errorMessage ?? "token invalid");
    }
}

