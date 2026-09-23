"""HTTP API; source files and the catalog are never served as static content."""
from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.catalog import CatalogError, load_catalog
from backend.matching import recommend
from backend.schemas import RecommendationRequest, RecommendationResponse
from backend.security import FRONTEND_CSP, SECURITY_HEADERS, HttpSecurityMiddleware

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger(__name__)

# Keep this list aligned with actual imports and frontend/serve.mjs.
# Repository instructions, preview servers and configuration are never assets.
PUBLIC_FRONTEND_FILES = frozenset({
    "index.html", "styles.css", "view.mjs", "api.mjs", "app.mjs",
})


class PublicFrontendFiles(StaticFiles):
    """Serve only explicit browser assets; retain Starlette MIME/HEAD handling."""

    async def get_response(self, path: str, scope):
        public_path = "index.html" if path in ("", ".") else path
        if public_path not in PUBLIC_FRONTEND_FILES:
            raise HTTPException(status_code=404)
        response = await super().get_response(public_path, scope)
        response.headers["Content-Security-Policy"] = FRONTEND_CSP
        return response


def catalog_diagnostic(exc: Exception) -> str:
    """Explain known loader errors locally without logging source records."""
    cause = exc.__cause__ or exc
    if isinstance(cause, FileNotFoundError):
        return "Файл каталога отсутствует."
    if isinstance(cause, PermissionError):
        return "Нет доступа для чтения файла каталога."
    if isinstance(cause, UnicodeError):
        return "Файл каталога должен иметь кодировку UTF-8."
    if isinstance(exc, CatalogError):
        # CatalogError contains schema/row/field diagnostics, not raw CSV rows.
        return str(exc)
    return "Не удалось прочитать или проверить файл каталога."


def error_response(status: int, code: str, message: str, fields: dict | None = None):
    return JSONResponse(status_code=status, content={
        "error": {"code": code, "message": message, "fields": fields or {}}
    }, headers=SECURITY_HEADERS)


def create_app(data_path: Path | None = None, frontend_dir: Path | None = None) -> FastAPI:
    catalog_path = Path(data_path) if data_path is not None else ROOT / "data" / "contractors.csv"
    ui_path = Path(frontend_dir) if frontend_dir is not None else ROOT / "frontend"

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.catalog = None
        try:
            application.state.catalog = load_catalog(catalog_path)
        except (OSError, ValueError, UnicodeError) as exc:
            # Do not echo input data or machine paths to an API caller.
            log.error("Catalog unavailable (%s): %s", type(exc).__name__, catalog_diagnostic(exc))
        yield

    application = FastAPI(
        title="That's La Peace — подбор подрядчиков",
        description="До трёх рекомендаций с объяснениями на фактах выданного каталога.",
        version="1.0.0", lifespan=lifespan,
    )
    application.state.catalog = None
    application.add_middleware(HttpSecurityMiddleware)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        translations = {
            "missing": "Обязательное поле.",
            "extra_forbidden": "Неизвестное поле запроса.",
            "int_type": "Укажите целое число, не строку и не логическое значение.",
            "float_type": "Укажите число часов.",
            "string_type": "Укажите текстовое значение.",
            "string_too_short": "Поле не должно быть пустым.",
            "greater_than": "Число должно быть больше нуля.",
            "finite_number": "Укажите конечное число.",
            "json_invalid": "Неверный JSON.",
            "model_attributes_type": "Тело запроса должно быть JSON-объектом.",
        }
        fields = {}
        for issue in exc.errors():
            loc = [str(part) for part in issue.get("loc", ()) if part != "body"]
            key = ".".join(loc) if loc else "request"
            kind = issue.get("type", "")
            message = translations.get(kind, "Проверьте значение поля.")
            if kind == "value_error":
                # These are fixed messages from our validators, never raw request bodies.
                message = issue.get("msg", message).removeprefix("Value error, ")
            fields.setdefault(key, message)
        return error_response(422, "invalid_request", "Проверьте параметры мероприятия.", fields)

    @application.exception_handler(Exception)
    async def service_failure(request: Request, exc: Exception):
        log.error("Request failed (%s)", type(exc).__name__)
        return error_response(503, "service_unavailable", "Сервис временно недоступен. Повторите запрос позже.")

    def unavailable():
        return error_response(503, "service_unavailable", "Каталог недоступен. Проверьте файл данных и перезапустите сервер.")

    @application.get("/api/health")
    def health():
        catalog = application.state.catalog
        if catalog is None:
            return unavailable()
        return {"status": "ok", "api_version": 1, "dataset_count": len(catalog.profiles)}

    @application.get("/api/meta")
    def metadata():
        catalog = application.state.catalog
        return catalog.meta() if catalog is not None else unavailable()

    @application.post("/api/recommendations", response_model=RecommendationResponse)
    def recommendations(query: RecommendationRequest):
        catalog = application.state.catalog
        if catalog is None:
            return unavailable()
        choices = catalog.meta()
        fields = {}
        for field, group in (("city", "cities"), ("category", "categories"),
                             ("event_type", "event_types"), ("language", "languages")):
            value = getattr(query, field)
            if value is not None and value not in choices[group]:
                fields[field] = "Выберите значение из справочника /api/meta."
        if fields:
            return error_response(422, "invalid_request", "Проверьте параметры мероприятия.", fields)
        return recommend(catalog, query.model_dump())

    # API has priority; only the explicit public frontend assets are served.
    if ui_path.is_dir() and (ui_path / "index.html").is_file():
        application.mount("/", PublicFrontendFiles(directory=ui_path, html=False, follow_symlink=False), name="frontend")
    else:
        @application.get("/", include_in_schema=False)
        def pending_frontend():
            if application.state.catalog is None:
                return unavailable()
            return error_response(503, "service_unavailable", "API доступен через /api и /docs; интерфейс команды ещё не подключён.")
    return application


app = create_app()
