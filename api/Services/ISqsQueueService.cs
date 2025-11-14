using WardrobeItems.Api.Models;

namespace WardrobeItems.Api.Services;

public interface ISqsQueueService
{
    Task EnqueueShareEventAsync(ShareEventMessage message, CancellationToken cancellationToken = default);
}

