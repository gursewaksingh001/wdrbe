namespace WardrobeItems.Api.Middleware;

public interface IJwtValidator
{
    Task<AuthResult> ValidateTokenAsync(IDictionary<string, string?> headers);
}

public record AuthResult(bool IsValid, string? UserId, string? ErrorMessage)
{
    public static AuthResult Success(string userId) => new(true, userId, null);
    public static AuthResult Failure(string message) => new(false, null, message);
}

