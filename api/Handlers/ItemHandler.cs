using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using AWS.Lambda.Powertools.Logging;
using AWS.Lambda.Powertools.Metrics;
using WardrobeItems.Api.Models;
using WardrobeItems.Api.Repositories;

namespace WardrobeItems.Api.Handlers;

public class ItemHandler : IItemHandler
{
    private readonly IRepository _repository;
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public ItemHandler(IRepository repository)
    {
        _repository = repository;
    }

    public async Task<APIGatewayProxyResponse> CreateItemAsync(APIGatewayProxyRequest request, string userId)
    {
        if (request.PathParameters is null || !request.PathParameters.TryGetValue("userId", out var pathUserId) || pathUserId != userId)
        {
            return CreateResponse(403, new { error = "forbidden", message = "user mismatch" });
        }

        var createRequest = JsonSerializer.Deserialize<CreateItemRequest>(request.Body ?? string.Empty, _jsonOptions);
        if (createRequest is null)
        {
            return CreateResponse(400, new { error = "validation_failed", errors = new[] { "Invalid JSON payload" } });
        }

        if (!createRequest.IsValid(out var errors))
        {
            return CreateResponse(400, new { error = "validation_failed", errors });
        }

        if (!string.IsNullOrEmpty(createRequest.IdempotencyKey))
        {
            var existing = await _repository.GetItemByIdempotencyKeyAsync(userId, createRequest.IdempotencyKey);
            if (existing is not null)
            {
                Logger.LogInformation("Idempotent create returning existing item", new
                {
                    existing.ItemId,
                    existing.UserId,
                    createRequest.IdempotencyKey
                });
                Metrics.AddMetric("ItemCreatedIdempotent", 1, MetricUnit.Count);
                return CreateResponse(200, existing);
            }
        }

        var item = new WardrobeItem
        {
            ItemId = createRequest.ItemId,
            UserId = userId,
            Name = createRequest.Name,
            Category = createRequest.Category,
            Season = createRequest.Season,
            Color = createRequest.Color,
            Brand = createRequest.Brand,
            PurchaseDate = createRequest.PurchaseDate,
            ImageUrl = createRequest.ImageUrl,
            IdempotencyKey = createRequest.IdempotencyKey
        };

        await _repository.UpsertItemAsync(item);

        Logger.LogInformation("Item created", new
        {
            item.ItemId,
            item.UserId,
            item.Category,
            item.Season
        });

        Metrics.AddMetric("ItemCreated", 1, MetricUnit.Count);
        Metrics.AddMetric($"ItemCreated_{item.Category}", 1, MetricUnit.Count);

        return CreateResponse(201, item);
    }

    public async Task<APIGatewayProxyResponse> ListItemsAsync(APIGatewayProxyRequest request, string userId)
    {
        if (request.PathParameters is null || !request.PathParameters.TryGetValue("userId", out var pathUserId) || pathUserId != userId)
        {
            return CreateResponse(403, new { error = "forbidden", message = "user mismatch" });
        }

        var query = request.QueryStringParameters ?? new Dictionary<string, string>();
        query.TryGetValue("season", out var season);
        query.TryGetValue("category", out var category);
        query.TryGetValue("limit", out var limitValue);
        query.TryGetValue("cursor", out var cursor);

        var limit = ParseLimit(limitValue);

        var result = await _repository.ListItemsAsync(userId, season, category, limit, cursor);
        var items = result.Items;
        var nextCursor = result.LastEvaluatedKey;

        var response = new ListItemsResponse
        {
            Items = items.ToList(),
            NextCursor = nextCursor,
            HasMore = nextCursor is not null
        };

        Logger.LogInformation("Items listed", new
        {
            userId,
            Count = items.Count,
            Season = season,
            Category = category,
            HasMore = response.HasMore
        });

        Metrics.AddMetric("ItemsListed", items.Count, MetricUnit.Count);

        return CreateResponse(200, response);
    }

    private static int ParseLimit(string? value)
    {
        if (!int.TryParse(value, out var limit) || limit <= 0)
        {
            limit = 20;
        }

        return Math.Clamp(limit, 1, 100);
    }

    private APIGatewayProxyResponse CreateResponse(int statusCode, object payload)
    {
        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = JsonSerializer.Serialize(payload, _jsonOptions),
            Headers = new Dictionary<string, string>
            {
                { "Content-Type", "application/json" },
                { "Access-Control-Allow-Origin", "*" },
                { "Access-Control-Allow-Headers", "Content-Type,Authorization,X-Request-Id" }
            }
        };
    }
}

