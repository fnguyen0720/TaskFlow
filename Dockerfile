FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY backend/TaskFlow.Api/TaskFlow.Api.csproj backend/TaskFlow.Api/
RUN dotnet restore backend/TaskFlow.Api/TaskFlow.Api.csproj

COPY backend/TaskFlow.Api/ backend/TaskFlow.Api/
WORKDIR /src/backend/TaskFlow.Api

RUN dotnet publish TaskFlow.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000

ENTRYPOINT ["dotnet", "TaskFlow.Api.dll"]
