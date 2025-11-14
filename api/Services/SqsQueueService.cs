using System.Text.Json;
using Amazon.SQS;
using Amazon.SQS.Model;
using AWS.Lambda.Powertools.Logging;
using WardrobeItems.Api.Models;

namespace WardrobeItems.Api.Services;

public class SqsQueueService : ISqsQueueService
{
    private readonly IAmazonSQS _sqs;
    private readonly string _queueUrl;

    public SqsQueueService(string queueUrl, IAmazonSQS? sqs = null)
    {
        _queueUrl = queueUrl;
        _sqs = sqs ?? new AmazonSQSClient();
    }

    public async Task EnqueueShareEventAsync(ShareEventMessage message, CancellationToken cancellationToken = default)
    {
        var payload = JsonSerializer.Serialize(message);
        var request = new SendMessageRequest
        {
            QueueUrl = _queueUrl,
            MessageBody = payload,
            MessageAttributes = new Dictionary<string, MessageAttributeValue>
            {
                { "EventType", new MessageAttributeValue { DataType = "String", StringValue = message.Type } },
                { "UserId", new MessageAttributeValue { DataType = "String", StringValue = message.UserId } },
                { "RequestId", new MessageAttributeValue { DataType = "String", StringValue = message.RequestId } }
            }
        };

        try
        {
            var response = await _sqs.SendMessageAsync(request, cancellationToken);
            Logger.LogInformation("Share event enqueued", new
            {
                message.ItemId,
                message.UserId,
                message.RequestId,
                response.MessageId
            });
        }
        catch (Exception ex)
        {
            Logger.LogError("Failed to enqueue share event", new
            {
                message.ItemId,
                message.UserId,
                message.RequestId,
                Error = ex.Message
            });
            throw;
        }
    }
}

