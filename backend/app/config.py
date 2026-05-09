"""应用配置 + 算法配置。

- Settings：运行时环境变量（DATABASE_URL / REDIS_URL / DATA_ROOT 等）
- AlgorithmConfig：算法层魔数（min_separation / savgol 窗口 / mBVD 物理约束等）

魔数全部集中在此，不允许在算法实现里写硬编码常量。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """运行时配置（来自环境变量 / .env）。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 数据库
    DATABASE_URL: str = "postgresql+psycopg://aln:aln@localhost:5432/aln"

    # 任务队列
    REDIS_URL: str = "redis://localhost:6379/0"

    # 数据根目录（容器内挂载点；本地开发可指向 /data3/aln）
    DATA_ROOT: Path = Path("/data3/aln")

    # 上传限制
    UPLOAD_MAX_GB: int = 20

    # 日志
    LOG_LEVEL: str = "INFO"

    # 调试
    DEBUG: bool = False

    @property
    def uploads_dir(self) -> Path:
        return self.DATA_ROOT / "uploads"

    @property
    def files_dir(self) -> Path:
        return self.DATA_ROOT / "files"

    @property
    def mappings_dir(self) -> Path:
        return self.DATA_ROOT / "mappings"

    @property
    def exports_dir(self) -> Path:
        return self.DATA_ROOT / "exports"

    @property
    def logs_dir(self) -> Path:
        return self.DATA_ROOT / "logs"


@dataclass
class AlgorithmConfig:
    """算法层魔数（全部从客户脚本里抽出来）。

    详见 docs/algorithm-port.md 第 4 节。
    """

    # ── 谐振峰检测 ────────────────────────────────────────────
    min_separation_hz: float = 20e6  # fs/fp 最小间距

    # ── BodeQ 平滑与拟合 ──────────────────────────────────────
    savgol_window: int = 51  # Savitzky-Golay 窗口（自动 cap 到 len(data)//10*2+1）
    savgol_polyorder: int = 3
    lorentz_peak_range_ratio: float = 0.3  # 拟合带宽 = 总点数 × 该比例（前后各取）

    # ── 中间寄生峰检测 ────────────────────────────────────────
    intermediate_peak_prominence_db: float = 3.0
    intermediate_peak_smooth_window_ratio: float = 0.01
    intermediate_peak_min_valley_sep_ratio: float = 0.02

    # ── BodeQ 边界 ────────────────────────────────────────────
    bodeq_boundary_ratio: float = 0.05  # 前后各裁掉 5% 防边界拟合崩坏

    # ── 阻抗下限（避免 log(0)） ──────────────────────────────
    z_db_floor: float = 1e-12

    # ── 并发 ──────────────────────────────────────────────────
    threadpool_max_workers: int = 4

    # ── 数据清洗 ──────────────────────────────────────────────
    # 任一列为 NA/空 → 整行丢弃（来自需求文档 3.1）
    required_numeric_columns: tuple[str, ...] = field(
        default_factory=lambda: (
            "fs_ghz",
            "fp_ghz",
            "zs_ohm",
            "zp_ohm",
            "qs",
            "qp",
            "qs_bodeq",
            "qp_bodeq",
            "dbqs",
            "dbqp",
            "bodeq_fitted",
            "bodeq_smooth",
            "fbode_ghz",
            "k2eff_pct",
        )
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_algorithm_config() -> AlgorithmConfig:
    return AlgorithmConfig()
