using System.Text;
using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using AWS.Lambda.Powertools.Logging;
using WardrobeItems.Api.Models;

namespace WardrobeItems.Api.Repositories;

public class DynamoDbRepository : IRepository
{
    private readonly IAmazonDynamoDB _client;
    private readonly string _tableName;

    public DynamoDbRepository(string tableName, IAmazonDynamoDB? client = null)
    {
        _tableName = tableName;
        _client = client ?? new AmazonDynamoDBClient();
    }

    public async Task<WardrobeItem?> GetItemAsync(string itemId)
    {
        var request = new GetItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                { "PK", new AttributeValue { S = $"ITEM#{itemId}" } },
                { "SK", new AttributeValue { S = "METADATA" } }
            }
        };

        var response = await _client.GetItemAsync(request);
        return response.Item.Count == 0 ? null : MapItem(response.Item);
    }

    public async Task<WardrobeItem?> GetItemByIdempotencyKeyAsync(string userId, string idempotencyKey)
    {
        var query = new QueryRequest
        {
            TableName = _tableName,
            IndexName = "GSI1",
            KeyConditionExpression = "GSI1PK = :pk AND GSI1SK = :sk",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                { ":pk", new AttributeValue { S = $"USER#{userId}" } },
                { ":sk", new AttributeValue { S = $"IDEMPOTENCY#{idempotencyKey}" } }
            },
            Limit = 1
        };

        var response = await _client.QueryAsync(query);
        if (response.Items.Count == 0)
        {
            return null;
        }

        var itemId = response.Items[0].GetValueOrDefault("ItemId")?.S;
        return string.IsNullOrEmpty(itemId) ? null : await GetItemAsync(itemId);
    }

    public async Task<WardrobeItem> UpsertItemAsync(WardrobeItem item)
    {
        var now = DateTime.UtcNow.ToString("o");
        item.CreatedAt = string.IsNullOrEmpty(item.CreatedAt) ? now : item.CreatedAt;
        item.UpdatedAt = now;

        var itemAttributes = new Dictionary<string, AttributeValue>
        {
            { "PK", new AttributeValue { S = $"ITEM#{item.ItemId}" } },
            { "SK", new AttributeValue { S = "METADATA" } },
            { "UserId", new AttributeValue { S = item.UserId } },
            { "Name", new AttributeValue { S = item.Name } },
            { "Category", new AttributeValue { S = item.Category } },
            { "CreatedAt", new AttributeValue { S = item.CreatedAt } },
            { "UpdatedAt", new AttributeValue { S = item.UpdatedAt } },
            { "SharedCount", new AttributeValue { N = item.SharedCount.ToString() } },
            { "IsPublic", new AttributeValue { BOOL = item.IsPublic } },
            { "EntityType", new AttributeValue { S = "Item" } }
        };

        if (!string.IsNullOrEmpty(item.Season))
        {
            itemAttributes.Add("Season", new AttributeValue { S = item.Season });
        }

        if (!string.IsNullOrEmpty(item.Color))
        {
            itemAttributes.Add("Color", new AttributeValue { S = item.Color });
        }

        if (!string.IsNullOrEmpty(item.Brand))
        {
            itemAttributes.Add("Brand", new AttributeValue { S = item.Brand });
        }

        if (!string.IsNullOrEmpty(item.PurchaseDate))
        {
            itemAttributes.Add("PurchaseDate", new AttributeValue { S = item.PurchaseDate });
        }

        if (!string.IsNullOrEmpty(item.ImageUrl))
        {
            itemAttributes.Add("ImageUrl", new AttributeValue { S = item.ImageUrl });
        }

        if (!string.IsNullOrEmpty(item.IdempotencyKey))
        {
            itemAttributes.Add("IdempotencyKey", new AttributeValue { S = item.IdempotencyKey });
        }

        var userItemAttributes = new Dictionary<string, AttributeValue>
        {
            { "PK", new AttributeValue { S = $"USER#{item.UserId}" } },
            { "SK", new AttributeValue { S = $"ITEM#{item.ItemId}" } },
            { "ItemId", new AttributeValue { S = item.ItemId } },
            { "Name", new AttributeValue { S = item.Name } },
            { "Category", new AttributeValue { S = item.Category } },
            { "EntityType", new AttributeValue { S = "UserItem" } },
            {
                "GSI1PK",
                new AttributeValue
                {
                    S = $"USER#{item.UserId}#SEASON#{(string.IsNullOrEmpty(item.Season) ? "all-season" : item.Season.ToLowerInvariant())}"
                }
            },
            { "GSI1SK", new AttributeValue { S = $"ITEM#{item.UpdatedAt}" } }
        };

        if (!string.IsNullOrEmpty(item.Season))
        {
            userItemAttributes.Add("Season", new AttributeValue { S = item.Season });
        }

        if (!string.IsNullOrEmpty(item.Color))
        {
            userItemAttributes.Add("Color", new AttributeValue { S = item.Color });
        }

        if (!string.IsNullOrEmpty(item.Brand))
        {
            userItemAttributes.Add("Brand", new AttributeValue { S = item.Brand });
        }

        if (!string.IsNullOrEmpty(item.PurchaseDate))
        {
            userItemAttributes.Add("PurchaseDate", new AttributeValue { S = item.PurchaseDate });
        }

        if (!string.IsNullOrEmpty(item.ImageUrl))
        {
            userItemAttributes.Add("ImageUrl", new AttributeValue { S = item.ImageUrl });
        }

        if (!string.IsNullOrEmpty(item.IdempotencyKey))
        {
            userItemAttributes.Add("IdempotencyKey", new AttributeValue { S = item.IdempotencyKey });
        }

        var transactItems = new List<TransactWriteItem>
        {
            new()
            {
                Put = new Put
                {
                    TableName = _tableName,
                    Item = itemAttributes
                }
            },
            new()
            {
                Put = new Put
                {
                    TableName = _tableName,
                    Item = userItemAttributes
                }
            }
        };

        if (!string.IsNullOrEmpty(item.IdempotencyKey))
        {
            transactItems.Add(new TransactWriteItem
            {
                Put = new Put
                {
                    TableName = _tableName,
                    Item = new Dictionary<string, AttributeValue>
            {
                { "PK", new AttributeValue { S = $"USER#{item.UserId}" } },
                { "SK", new AttributeValue { S = $"IDEMPOTENCY#{item.IdempotencyKey}" } },
                        { "ItemId", new AttributeValue { S = item.ItemId } },
                        { "EntityType", new AttributeValue { S = "Idempotency" } },
                        { "CreatedAt", new AttributeValue { S = item.CreatedAt } },
                { "GSI1PK", new AttributeValue { S = $"USER#{item.UserId}" } },
                        { "GSI1SK", new AttributeValue { S = $"IDEMPOTENCY#{item.IdempotencyKey}" } }
                    }
                }
            });
        }

        await _client.TransactWriteItemsAsync(new TransactWriteItemsRequest
        {
            TransactItems = transactItems
        });

        return item;
    }

    public async Task<(IReadOnlyList<WardrobeItem> Items, string? LastEvaluatedKey)> ListItemsAsync(
        string userId,
        string? season,
        string? category,
        int limit,
        string? cursor)
    {
        QueryRequest request;
        if (!string.IsNullOrWhiteSpace(season))
        {
            request = new QueryRequest
            {
                TableName = _tableName,
                IndexName = "GSI1",
                KeyConditionExpression = "GSI1PK = :pk",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":pk", new AttributeValue { S = $"USER#{userId}#SEASON#{season.ToLowerInvariant()}" } }
                },
                ScanIndexForward = false,
                Limit = limit
            };
        }
        else
        {
            request = new QueryRequest
            {
                TableName = _tableName,
                KeyConditionExpression = "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":pk", new AttributeValue { S = $"USER#{userId}" } },
                    { ":sk", new AttributeValue { S = "ITEM#" } }
                },
                ScanIndexForward = false,
                Limit = limit
            };
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            request.FilterExpression = "Category = :category";
            request.ExpressionAttributeValues.Add(":category", new AttributeValue { S = category });
        }

        if (!string.IsNullOrWhiteSpace(cursor))
        {
            try
            {
                var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
                var keys = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(decoded);
                if (keys is not null)
                {
                    request.ExclusiveStartKey = keys.ToDictionary(
                        kvp => kvp.Key,
                        kvp => new AttributeValue { S = kvp.Value.GetValueOrDefault("S") }
                    );
                }
            }
            catch (FormatException)
            {
                Logger.LogWarning("Invalid pagination cursor provided", new { cursor });
            }
        }

        var response = await _client.QueryAsync(request);
        var items = new List<WardrobeItem>();
        foreach (var row in response.Items)
        {
            var itemId = row.GetValueOrDefault("ItemId")?.S;
            if (string.IsNullOrEmpty(itemId))
            {
                continue;
            }

            var item = await GetItemAsync(itemId);
            if (item is not null)
            {
                items.Add(item);
            }
        }

        string? nextCursor = null;
        if (response.LastEvaluatedKey.Count > 0)
        {
            var nextKey = response.LastEvaluatedKey.ToDictionary(
                kvp => kvp.Key,
                kvp => new Dictionary<string, string> { { "S", kvp.Value.S! } }
            );
            nextCursor = Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(nextKey)));
        }

        return (items, nextCursor);
    }

    public async Task IncrementShareCountAsync(string itemId, string userId)
    {
        var request = new UpdateItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                { "PK", new AttributeValue { S = $"ITEM#{itemId}" } },
                { "SK", new AttributeValue { S = "METADATA" } }
            },
            ConditionExpression = "UserId = :userId",
            UpdateExpression = "SET SharedCount = if_not_exists(SharedCount, :zero) + :inc, IsPublic = :isPublic, UpdatedAt = :updated",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                { ":userId", new AttributeValue { S = userId } },
                { ":zero", new AttributeValue { N = "0" } },
                { ":inc", new AttributeValue { N = "1" } },
                { ":isPublic", new AttributeValue { BOOL = true } },
                { ":updated", new AttributeValue { S = DateTime.UtcNow.ToString("o") } }
            }
        };

        await _client.UpdateItemAsync(request);
    }

    public async Task CreateActivityAsync(ActivityRecord activity)
    {
        var item = new Dictionary<string, AttributeValue>
            {
                { "PK", new AttributeValue { S = $"USER#{activity.UserId}" } },
                { "SK", new AttributeValue { S = $"ACTIVITY#{activity.ActivityId}" } },
                { "ActivityType", new AttributeValue { S = activity.ActivityType } },
                { "ItemId", new AttributeValue { S = activity.ItemId } },
                { "Timestamp", new AttributeValue { S = activity.Timestamp } },
                { "EntityType", new AttributeValue { S = "Activity" } }
        };

        if (!string.IsNullOrEmpty(activity.ItemName))
        {
            item.Add("ItemName", new AttributeValue { S = activity.ItemName });
        }

        if (activity.Metadata is not null)
        {
            item.Add("Metadata", new AttributeValue { S = JsonSerializer.Serialize(activity.Metadata) });
        }

        await _client.PutItemAsync(new PutItemRequest
        {
            TableName = _tableName,
            Item = item
        });
    }

    private static WardrobeItem MapItem(Dictionary<string, AttributeValue> item)
    {
        return new WardrobeItem
        {
            ItemId = item["PK"].S.Replace("ITEM#", string.Empty, StringComparison.Ordinal),
            UserId = item.GetValueOrDefault("UserId")?.S ?? string.Empty,
            Name = item.GetValueOrDefault("Name")?.S ?? string.Empty,
            Category = item.GetValueOrDefault("Category")?.S ?? string.Empty,
            Season = item.GetValueOrDefault("Season")?.S,
            Color = item.GetValueOrDefault("Color")?.S,
            Brand = item.GetValueOrDefault("Brand")?.S,
            PurchaseDate = item.GetValueOrDefault("PurchaseDate")?.S,
            ImageUrl = item.GetValueOrDefault("ImageUrl")?.S,
            SharedCount = item.GetValueOrDefault("SharedCount") is { } shared ? int.Parse(shared.N) : 0,
            IsPublic = item.GetValueOrDefault("IsPublic")?.BOOL ?? false,
            CreatedAt = item.GetValueOrDefault("CreatedAt")?.S ?? string.Empty,
            UpdatedAt = item.GetValueOrDefault("UpdatedAt")?.S ?? string.Empty,
            IdempotencyKey = item.GetValueOrDefault("IdempotencyKey")?.S
        };
    }
}

