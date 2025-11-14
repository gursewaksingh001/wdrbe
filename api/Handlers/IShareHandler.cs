using Amazon.Lambda.APIGatewayEvents;

namespace WardrobeItems.Api.Handlers;

public interface IShareHandler
{
    Task<APIGatewayProxyResponse> ShareItemAsync(APIGatewayProxyRequest request, string userId);
}

