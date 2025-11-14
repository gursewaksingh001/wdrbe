using System.Text.Json.Serialization;

namespace WardrobeItems.Api.Models;

public class WardrobeItem
{
    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("season")]
    public string? Season { get; set; }

    [JsonPropertyName("color")]
    public string? Color { get; set; }

    [JsonPropertyName("brand")]
    public string? Brand { get; set; }

    [JsonPropertyName("purchaseDate")]
    public string? PurchaseDate { get; set; }

    [JsonPropertyName("imageUrl")]
    public string? ImageUrl { get; set; }

    [JsonPropertyName("sharedCount")]
    public int SharedCount { get; set; }

    [JsonPropertyName("isPublic")]
    public bool IsPublic { get; set; }

    [JsonPropertyName("createdAt")]
    public string CreatedAt { get; set; } = string.Empty;

    [JsonPropertyName("updatedAt")]
    public string UpdatedAt { get; set; } = string.Empty;

    [JsonPropertyName("idempotencyKey")]
    public string? IdempotencyKey { get; set; }
}

public class CreateItemRequest
{
    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("season")]
    public string? Season { get; set; }

    [JsonPropertyName("color")]
    public string? Color { get; set; }

    [JsonPropertyName("brand")]
    public string? Brand { get; set; }

    [JsonPropertyName("purchaseDate")]
    public string? PurchaseDate { get; set; }

    [JsonPropertyName("imageUrl")]
    public string? ImageUrl { get; set; }

    [JsonPropertyName("idempotencyKey")]
    public string? IdempotencyKey { get; set; }

    public bool IsValid(out List<string> errors)
    {
        errors = new List<string>();

        if (string.IsNullOrWhiteSpace(ItemId))
            errors.Add("itemId is required");

        if (string.IsNullOrWhiteSpace(Name))
            errors.Add("name is required");

        if (string.IsNullOrWhiteSpace(Category))
            errors.Add("category is required");

        if (Name is { Length: > 200 })
            errors.Add("name must be 200 characters or fewer");

        if (Category is { Length: > 100 })
            errors.Add("category must be 100 characters or fewer");

        if (!string.IsNullOrWhiteSpace(Season))
        {
            var allowed = new[] { "spring", "summer", "autumn", "fall", "winter", "all-season" };
            if (!allowed.Contains(Season, StringComparer.OrdinalIgnoreCase))
            {
                errors.Add($"season must be one of: {string.Join(", ", allowed)}");
            }
        }

        return errors.Count == 0;
    }
}

public class ListItemsResponse
{
    [JsonPropertyName("items")]
    public List<WardrobeItem> Items { get; set; } = new();

    [JsonPropertyName("nextCursor")]
    public string? NextCursor { get; set; }

    [JsonPropertyName("hasMore")]
    public bool HasMore { get; set; }
}

public class ShareEventMessage
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "SHARE_ITEM";

    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    [JsonPropertyName("timestamp")]
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");

    [JsonPropertyName("requestId")]
    public string RequestId { get; set; } = Guid.NewGuid().ToString();
}

public class ActivityRecord
{
    public string ActivityId { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = string.Empty;
    public string ActivityType { get; set; } = "ItemShared";
    public string ItemId { get; set; } = string.Empty;
    public string? ItemName { get; set; }
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");
    public Dictionary<string, string>? Metadata { get; set; }
}

