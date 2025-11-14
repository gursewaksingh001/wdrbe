using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using AWS.Lambda.Powertools.Logging;
using AWS.Lambda.Powertools.Metrics;
using AWS.Lambda.Powertools.Tracing;
using WardrobeItems.Api.Handlers;
using WardrobeItems.Api.Middleware;
using WardrobeItems.Api.Repositories;
using WardrobeItems.Api.Services;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace WardrobeItems.Api;

public class Function
{
    private readonly IItemHandler _itemHandler;
    private readonly IShareHandler _shareHandler;
    private readonly IJwtValidator _jwtValidator;

    public Function()
    {
        var tableName = Environment.GetEnvironmentVariable("TABLE_NAME")
                         ?? throw new InvalidOperationException("TABLE_NAME is not set");
        var queueUrl = Environment.GetEnvironmentVariable("QUEUE_URL")
                        ?? throw new InvalidOperationException("QUEUE_URL is not set");
        var jwtSecretParam = Environment.GetEnvironmentVariable("JWT_SECRET_PARAM")
                              ?? throw new InvalidOperationException("JWT_SECRET_PARAM is not set");

        var repository = new DynamoDbRepository(tableName);
        var queueService = new SqsQueueService(queueUrl);
        var jwtService = new JwtService(jwtSecretParam);

        _itemHandler = new ItemHandler(repository);
        _shareHandler = new ShareHandler(repository, queueService);
        _jwtValidator = new JwtValidator(jwtService);
    }

    [Logging(LogEvent = true)]
    [Tracing(CaptureMode = TracingCaptureMode.ResponseAndError)]
    [Metrics(Namespace = "Wdrbe", Service = "SyncApi")]
    public async Task<APIGatewayProxyResponse> FunctionHandler(APIGatewayProxyRequest request, ILambdaContext context)
    {
        try
        {
            var authResult = await _jwtValidator.ValidateTokenAsync(request.Headers);
            if (!authResult.IsValid)
            {
                return CreateResponse(401, new { error = "unauthorized", message = authResult.ErrorMessage });
            }

            return (request.HttpMethod.ToUpperInvariant(), request.Resource) switch
            {
                ("POST", "/users/{userId}/items") => await _itemHandler.CreateItemAsync(request, authResult.UserId!),
                ("GET", "/users/{userId}/items") => await _itemHandler.ListItemsAsync(request, authResult.UserId!),
                ("POST", "/items/{itemId}/share") => await _shareHandler.ShareItemAsync(request, authResult.UserId!),
                _ => CreateResponse(404, new { error = "not_found" })
            };
        }
        catch (JsonException ex)
        {
            Logger.LogError("Invalid JSON payload", ex);
            return CreateResponse(400, new { error = "bad_request", message = "Invalid JSON" });
        }
        catch (Exception ex)
        {
            Logger.LogError("Unhandled exception", ex);
            Metrics.AddMetric("UnhandledErrors", 1, MetricUnit.Count);
            return CreateResponse(500, new { error = "internal_error", message = ex.Message });
        }
    }

    private static APIGatewayProxyResponse CreateResponse(int statusCode, object body)
    {
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = JsonSerializer.Serialize(body, options),
            Headers = new Dictionary<string, string>
            {
                { "Content-Type", "application/json" },
                { "Access-Control-Allow-Origin", "*" },
                { "Access-Control-Allow-Headers", "Content-Type,Authorization,X-Request-Id" },
                { "Access-Control-Allow-Methods", "GET,POST,OPTIONS" }
            }
        };
    }
}

