from fastapi import APIRouter, HTTPException, Path, Response

from app.services.dart_company import DartAPIError, dart_company
from app.services.sec_company import SecAPIError, sec_company

router = APIRouter(prefix="/api/company", tags=["company"])


@router.get("/us/{symbol}")
async def us_company(
    response: Response,
    symbol: str = Path(pattern=r"^[A-Za-z][A-Za-z0-9.\-]{0,11}$"),
) -> dict:
    try:
        result = await sec_company.company(symbol)
        response.headers["Cache-Control"] = (
            "public, max-age=60, s-maxage=900, stale-while-revalidate=3600"
        )
        return result
    except SecAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail="미국 기업 공시를 잠시 불러오지 못했습니다.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="미국 기업정보 서비스에 일시적으로 연결할 수 없습니다.",
        ) from exc


@router.get("/{symbol}")
async def company(
    response: Response,
    symbol: str = Path(pattern=r"^\d{6}$"),
) -> dict:
    try:
        result = await dart_company.company(symbol)
        # DART company metadata changes slowly. A bounded shared cache keeps
        # repeated profile opens from consuming the public API quota. Only
        # successful responses receive a public cache policy.
        response.headers["Cache-Control"] = (
            "public, max-age=60, s-maxage=900, stale-while-revalidate=3600"
        )
        return result
    except DartAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail="기업 공시 정보를 잠시 불러오지 못했습니다.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="기업정보 서비스에 일시적으로 연결할 수 없습니다.",
        ) from exc
