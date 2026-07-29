from fastapi import APIRouter, HTTPException, Path

from app.services.dart_company import DartAPIError, dart_company

router = APIRouter(prefix="/api/company", tags=["company"])


@router.get("/{symbol}")
async def company(
    symbol: str = Path(pattern=r"^\d{6}$"),
) -> dict:
    try:
        return await dart_company.company(symbol)
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
