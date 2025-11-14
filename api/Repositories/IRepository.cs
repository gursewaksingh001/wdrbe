using WardrobeItems.Api.Models;

namespace WardrobeItems.Api.Repositories;

public interface IRepository
{
    Task<WardrobeItem?> GetItemAsync(string itemId);
    Task<WardrobeItem?> GetItemByIdempotencyKeyAsync(string userId, string idempotencyKey);
    Task<WardrobeItem> UpsertItemAsync(WardrobeItem item);
    Task<(IReadOnlyList<WardrobeItem> Items, string? LastEvaluatedKey)> ListItemsAsync(
        string userId,
        string? season,
        string? category,
        int limit,
        string? cursor);
    Task IncrementShareCountAsync(string itemId, string userId);
    Task CreateActivityAsync(ActivityRecord activity);
}

