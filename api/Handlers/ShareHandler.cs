using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using AWS.Lambda.Powertools.Logging;
using AWS.Lambda.Powertools.Metrics;
using WardrobeItems.Api.Models;
using WardrobeItems.Api.Repositories;
using WardrobeItems.Api.Services;

namespace WardrobeItems.Api.Handlers;

public class ShareHandler : IShareHandler
{
    private readonly IRepository _repository;
    private readonly ISqsQueueService _queueService;
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public ShareHandler(IRepository repository, ISqsQueueService queueService)
    {
        _repository = repository;
        _queueService = queueService;
    }

    public async Task<APIGatewayProxyResponse> ShareItemAsync(APIGatewayProxyRequest request, string userId)
    {
        if (request.PathParameters is null || !request.PathParameters.TryGetValue("itemId", out var itemId))
            {
            return CreateResponse(400, new { error = "bad_request", message = "missing itemId" });
            }

            var item = await _repository.GetItemAsync(itemId);
        if (item is null)
            {
            return CreateResponse(404, new { error = "not_found", message = "item not found" });
            }

        if (!string.Equals(item.UserId, userId, StringComparison.Ordinal))
            {
            return CreateResponse(403, new { error = "forbidden", message = "cannot share another user's item" });
            }

            var shareEvent = new ShareEventMessage
            {
                ItemId = itemId,
                UserId = userId,
                Timestamp = DateTime.UtcNow.ToString("o"),
                RequestId = request.RequestContext?.RequestId ?? Guid.NewGuid().ToString()
            };

        await _queueService.EnqueueShareEventAsync(shareEvent);

        Logger.LogInformation("Share request enqueued", new
            {
            itemId,
            userId,
            shareEvent.RequestId
            });

            Metrics.AddMetric("ShareEventsEnqueued", 1, MetricUnit.Count);

            return CreateResponse(202, new
            {
                itemId,
                status = "queued",
            eventId = shareEvent.RequestId
            });
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
                { "Access-Control-Allow-Origin", "*" }
            }
        };
    }
}

