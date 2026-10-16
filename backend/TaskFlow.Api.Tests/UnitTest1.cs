using Xunit;
using System.Net.Http.Json;
using System.Text.Json;

namespace TaskFlow.Api.Tests;

public class TaskApiTests
{
    [Theory]
[InlineData("GET", "/api/tasks")]
[InlineData("POST", "/api/tasks")]
[InlineData("PUT", "/api/tasks/1")]
[InlineData("PUT", "/api/tasks/1/title")]
[InlineData("DELETE", "/api/tasks/1")]
public async Task UnauthenticatedUser_CannotAccessTaskEndpoints(
    string method,
    string url)
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var request = new HttpRequestMessage(
        new HttpMethod(method),
        url);

    if (method == "POST" ||
        url.EndsWith("/title"))
    {
        request.Content = new StringContent(
            """{"title":"Unauthorized test","priority":"Medium","category":"General"}""",
            System.Text.Encoding.UTF8,
            "application/json");
    }

    using var response = await client.SendAsync(request);

    Assert.Equal(
        System.Net.HttpStatusCode.Unauthorized,
        response.StatusCode);
}
private static async Task<string> RegisterAndGetTokenAsync(
    HttpClient client,
    string email)
{
    var registration = await client.PostAsJsonAsync(
        "/register",
        new
        {
            email,
            password = "TestPassword123!"
        });

    registration.EnsureSuccessStatusCode();

    var login = await client.PostAsJsonAsync(
        "/login?useCookies=false",
        new
        {
            email,
            password = "TestPassword123!"
        });

    login.EnsureSuccessStatusCode();

    using var json = JsonDocument.Parse(
        await login.Content.ReadAsStringAsync());

    return json.RootElement
        .GetProperty("accessToken")
        .GetString()!;
}

[Fact]
public async Task AccountB_CannotSeeAccountATasks()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var clientA = factory.CreateClient();
    using var clientB = factory.CreateClient();

    var tokenA = await RegisterAndGetTokenAsync(
        clientA, "accounta@example.com");

    var tokenB = await RegisterAndGetTokenAsync(
        clientB, "accountb@example.com");

    clientA.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenA);

    var createResponse = await clientA.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Account A private task",
            priority = "High",
            category = "Work"
        });

    createResponse.EnsureSuccessStatusCode();

    clientB.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenB);

    var tasks = await clientB.GetFromJsonAsync<List<TaskItem>>(
        "/api/tasks");

    Assert.NotNull(tasks);
    Assert.DoesNotContain(
        tasks,
        task => task.Title == "Account A private task");
}

[Fact]
public async Task AccountB_CannotDeleteAccountATask()
{
    await using var factory = new CustomWebApplicationFactory();
    await factory.InitializeDatabaseAsync();

    var (_, tokenB, taskId) =
        await CreateTaskForAccountAAsync(factory);

    using var client = factory.CreateClient();
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenB);

    var response = await client.DeleteAsync(
        $"/api/tasks/{taskId}");

    Assert.Equal(
        System.Net.HttpStatusCode.NotFound,
        response.StatusCode);
}

[Fact]
public async Task AccountB_CannotCompleteAccountATask()
{
    await using var factory = new CustomWebApplicationFactory();
    await factory.InitializeDatabaseAsync();

    var (_, tokenB, taskId) =
        await CreateTaskForAccountAAsync(factory);

    using var client = factory.CreateClient();
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenB);

    var response = await client.PutAsync(
        $"/api/tasks/{taskId}", null);

    Assert.Equal(
        System.Net.HttpStatusCode.NotFound,
        response.StatusCode);
}

[Fact]
public async Task AccountB_CannotEditAccountATask()
{
    await using var factory = new CustomWebApplicationFactory();
    await factory.InitializeDatabaseAsync();

    var (tokenA, tokenB, taskId) =
        await CreateTaskForAccountAAsync(factory);

    using var client = factory.CreateClient();
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenB);

    var response = await client.PutAsJsonAsync(
        $"/api/tasks/{taskId}/title",
        new
        {
            title = "Hacked task",
            priority = "High",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.NotFound,
        response.StatusCode);

    using var clientA = factory.CreateClient();

    clientA.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenA);

    var tasks = await clientA.GetFromJsonAsync<List<TaskItem>>(
        "/api/tasks");

    Assert.NotNull(tasks);

    Assert.Contains(
        tasks,
        task => task.Id == taskId &&
                task.Title == "Private task" &&
                task.Priority == "Medium");
}

private static async Task<(string tokenA, string tokenB, int taskId)>


    CreateTaskForAccountAAsync(CustomWebApplicationFactory factory)
{
    using var clientA = factory.CreateClient();
    using var clientB = factory.CreateClient();

    var tokenA = await RegisterAndGetTokenAsync(
        clientA, $"accounta-{Guid.NewGuid()}@example.com");

    var tokenB = await RegisterAndGetTokenAsync(
        clientB, $"accountb-{Guid.NewGuid()}@example.com");

    clientA.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", tokenA);

    var response = await clientA.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Private task",
            priority = "Medium",
            category = "Work"
        });

    response.EnsureSuccessStatusCode();

    var task = await response.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(task);

    return (tokenA, tokenB, task.Id);
}

[Fact]
public async Task CreateTask_IgnoresForgedUserId()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    const string forgedUserId = "another-users-id";

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Ownership security test",
            priority = "Medium",
            category = "Work",
            userId = forgedUserId
        });

    Assert.Equal(
        System.Net.HttpStatusCode.Created,
        response.StatusCode);

    var createdTask =
        await response.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);

    Assert.NotEqual(
        forgedUserId,
        createdTask.UserId);

    var tasks = await client.GetFromJsonAsync<List<TaskItem>>(
        "/api/tasks");

    Assert.NotNull(tasks);

    Assert.Contains(
        tasks,
        task => task.Title == "Ownership security test"
            && task.UserId != forgedUserId);
}

[Fact]
public async Task Owner_CanCreateAndRetrieveOwnTask()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "My test task",
            priority = "High",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.Created,
        createResponse.StatusCode);

    var createdTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);
    Assert.Equal("My test task", createdTask.Title);
    Assert.Equal("High", createdTask.Priority);
    Assert.Equal("Work", createdTask.Category);

    var tasks = await client.GetFromJsonAsync<List<TaskItem>>(
        "/api/tasks");

    Assert.NotNull(tasks);

    Assert.Contains(
        tasks,
        task => task.Id == createdTask.Id);
}

[Fact]
public async Task Owner_CanCompleteOwnTask()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Task to complete",
            priority = "Medium",
            category = "Work"
        });

    createResponse.EnsureSuccessStatusCode();

    var createdTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);
    Assert.False(createdTask.Completed);

    var completeResponse = await client.PutAsync(
        $"/api/tasks/{createdTask.Id}",
        null);

    Assert.Equal(
        System.Net.HttpStatusCode.OK,
        completeResponse.StatusCode);

    var updatedTask =
        await completeResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(updatedTask);
    Assert.True(updatedTask.Completed);
}

[Fact]
public async Task Owner_CanEditOwnTask()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Original title",
            priority = "Low",
            category = "Personal"
        });

    createResponse.EnsureSuccessStatusCode();

    var createdTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);

    var newDueDate = new DateTime(2026, 12, 25);

    var editResponse = await client.PutAsJsonAsync(
        $"/api/tasks/{createdTask.Id}/title",
        new
        {
            title = "Updated title",
            priority = "High",
            category = "Work",
            dueDate = newDueDate
        });

    Assert.Equal(
        System.Net.HttpStatusCode.OK,
        editResponse.StatusCode);

    var updatedTask =
        await editResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(updatedTask);
    Assert.Equal("Updated title", updatedTask.Title);
    Assert.Equal("High", updatedTask.Priority);
    Assert.Equal("Work", updatedTask.Category);
    Assert.Equal(newDueDate, updatedTask.DueDate);
}

[Fact]
public async Task Owner_CanDeleteOwnTask()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Task to delete",
            priority = "Medium",
            category = "Work"
        });

    createResponse.EnsureSuccessStatusCode();

    var createdTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);

    var deleteResponse = await client.DeleteAsync(
        $"/api/tasks/{createdTask.Id}");

    Assert.Equal(
        System.Net.HttpStatusCode.NoContent,
        deleteResponse.StatusCode);

    var tasks = await client.GetFromJsonAsync<List<TaskItem>>(
        "/api/tasks");

    Assert.NotNull(tasks);

    Assert.DoesNotContain(
        tasks,
        task => task.Id == createdTask.Id);
}

[Fact]
public async Task CreateTask_WithEmptyTitle_ReturnsBadRequest()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "   ",
            priority = "Medium",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        response.StatusCode);
}

[Fact]
public async Task CreateTask_WithTitleOver100Characters_ReturnsBadRequest()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = new string('A', 101),
            priority = "Medium",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        response.StatusCode);
}

[Fact]
public async Task CreateTask_WithInvalidPriority_ReturnsBadRequest()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Test invalid priority",
            priority = "Urgent",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        response.StatusCode);
}

[Fact]
public async Task CreateTask_WithTitleOfExactly100Characters_Succeeds()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var title = new string('A', 100);

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title,
            priority = "Medium",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.Created,
        response.StatusCode);

    var createdTask =
        await response.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);
    Assert.Equal(100, createdTask.Title.Length);
}

[Fact]
public async Task CreateTask_WithWhitespaceTitle_ReturnsBadRequest()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var response = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "   ",
            priority = "Medium",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        response.StatusCode);
}

[Fact]
public async Task EditTask_WithInvalidPriority_ReturnsBadRequest()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Task to edit",
            priority = "Medium",
            category = "Work"
        });

    createResponse.EnsureSuccessStatusCode();

    var createdTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(createdTask);

    var editResponse = await client.PutAsJsonAsync(
        $"/api/tasks/{createdTask.Id}/title",
        new
        {
            title = "Updated task",
            priority = "Urgent",
            category = "Work"
        });

    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        editResponse.StatusCode);
}

[Fact]
public async Task EditTask_WithInvalidPriority_DoesNotModifyExistingTask()
{
    await using var factory =
        new CustomWebApplicationFactory();

    await factory.InitializeDatabaseAsync();

    using var client = factory.CreateClient();

    var token = await RegisterAndGetTokenAsync(
        client,
        $"owner-{Guid.NewGuid()}@example.com");

    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            token);

    // Arrange: Create a valid task.
    var createResponse = await client.PostAsJsonAsync(
        "/api/tasks",
        new
        {
            title = "Original task",
            priority = "Medium",
            category = "Work"
        });

    createResponse.EnsureSuccessStatusCode();

    var originalTask =
        await createResponse.Content.ReadFromJsonAsync<TaskItem>();

    Assert.NotNull(originalTask);

    // Act: Attempt an invalid edit.
    var editResponse = await client.PutAsJsonAsync(
        $"/api/tasks/{originalTask.Id}/title",
        new
        {
            title = "Changed title",
            priority = "Urgent",
            category = "Personal"
        });

    // Assert: The API rejects the edit.
    Assert.Equal(
        System.Net.HttpStatusCode.BadRequest,
        editResponse.StatusCode);

    // Assert: The task remains unchanged in the database.
    var getResponse = await client.GetAsync("/api/tasks");

    getResponse.EnsureSuccessStatusCode();

    var tasks =
        await getResponse.Content.ReadFromJsonAsync<List<TaskItem>>();

    Assert.NotNull(tasks);

    var storedTask = Assert.Single(
        tasks,
        task => task.Id == originalTask.Id);

    Assert.Equal("Original task", storedTask.Title);
    Assert.Equal("Medium", storedTask.Priority);
    Assert.Equal("Work", storedTask.Category);
}

}