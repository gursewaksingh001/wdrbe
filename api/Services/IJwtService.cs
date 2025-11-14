namespace WardrobeItems.Api.Services;

public interface IJwtService
{
    Task<string> GetSecretAsync(CancellationToken cancellationToken = default);
    (bool IsValid, string? UserId, string? ErrorMessage) ValidateToken(string token, string secret);
}

