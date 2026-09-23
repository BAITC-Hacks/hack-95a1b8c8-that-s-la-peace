"""Small ASGI boundary: bounded request bodies and baseline HTTP headers."""
from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_REQUEST_BODY_BYTES = 16 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}
FRONTEND_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    "img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)


def oversized_response() -> JSONResponse:
    return JSONResponse(
        status_code=413,
        content={"error": {
            "code": "request_too_large",
            "message": "Размер тела запроса превышает 16 КиБ.",
            "fields": {},
        }},
        headers=SECURITY_HEADERS,
    )


class HttpSecurityMiddleware:
    """Count actual ASGI bytes before JSON parsing, independent of declared size.

    At most 16 KiB is buffered. An oversized declaration is rejected without
    reading the body; otherwise every received chunk contributes to the limit.
    Lifespan and websocket scopes are passed through untouched.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def secure_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers[name] = value
            await send(message)

        for name, value in scope.get("headers", ()):
            if name.lower() == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    continue  # The actual-body limit still applies.
                if declared > MAX_REQUEST_BODY_BYTES:
                    await oversized_response()(scope, receive, secure_send)
                    return

        buffered = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            if len(buffered) + len(chunk) > MAX_REQUEST_BODY_BYTES:
                await oversized_response()(scope, receive, secure_send)
                return
            buffered.extend(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def limited_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(buffered), "more_body": False}
            return await receive()

        await self.app(scope, limited_receive, secure_send)
