import asyncio

import httpx

from app.main import app


def test_health_and_versioned_contract() -> None:
    async def check() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/health")).status_code == 200
            schema = (await client.get("/openapi.json")).json()
            assert "/api/v1/auth/login" in schema["paths"]

    asyncio.run(check())


def test_planning_requires_authentication() -> None:
    async def check() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/events")).status_code == 401

    asyncio.run(check())
