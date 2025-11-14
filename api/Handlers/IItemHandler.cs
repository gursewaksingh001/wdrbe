using Amazon.Lambda.APIGatewayEvents;

namespace WardrobeItems.Api.Handlers;

public interface IItemHandler
{
    Task<APIGatewayProxyResponse> CreateItemAsync(APIGatewayProxyRequest request, string userId);
    Task<APIGatewayProxyResponse> ListItemsAsync(APIGatewayProxyRequest request, string userId);
}

