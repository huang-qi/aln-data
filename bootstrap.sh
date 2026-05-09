#!/usr/bin/env bash
# 谐振器测试数据平台 - 一键启动
# 用法：./bootstrap.sh [up|down|reset|status]
#   up      启动全部 5 容器（默认）
#   down    停止全部容器（保留数据）
#   reset   销毁容器 + 删除 /data3/aln 业务数据（需二次确认）
#   status  查看容器状态 + /api/health + 磁盘

set -euo pipefail

# ---------- 路径 / 常量 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/deploy/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"
DATA_ROOT="/data3/aln"
DATA_SUBDIRS=(pgdata redis uploads files mappings exports logs/api logs/worker)
FRONTEND_DIST="${SCRIPT_DIR}/frontend/dist"

NGINX_PORT_DEFAULT="18080"
HEALTH_TIMEOUT_SECS=60

# ---------- 颜色 ----------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    C_RED=$'\033[31m'
    C_GRN=$'\033[32m'
    C_YEL=$'\033[33m'
    C_RST=$'\033[0m'
else
    C_RED=""
    C_GRN=""
    C_YEL=""
    C_RST=""
fi

log_info()  { printf '%s[INFO]%s  %s\n'  "${C_YEL}" "${C_RST}" "$*"; }
log_ok()    { printf '%s[OK]%s    %s\n'  "${C_GRN}" "${C_RST}" "$*"; }
log_error() { printf '%s[ERROR]%s %s\n'  "${C_RED}" "${C_RST}" "$*" >&2; }

die() {
    log_error "$*"
    exit 1
}

# ---------- 通用工具 ----------
get_nginx_port() {
    if [[ -f "${ENV_FILE}" ]]; then
        local v
        v="$(grep -E '^NGINX_PORT=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
        [[ -n "${v}" ]] && { echo "${v}"; return; }
    fi
    echo "${NGINX_PORT_DEFAULT}"
}

compose() {
    podman compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

# ---------- 前置检查 ----------
check_env_file() {
    if [[ ! -f "${ENV_FILE}" ]]; then
        log_error ".env 不存在"
        log_info  "请先执行：cp ${ENV_EXAMPLE} ${ENV_FILE}  并修改 POSTGRES_PASSWORD"
        exit 1
    fi
    log_ok ".env 已就位"
}

check_podman() {
    command -v podman >/dev/null 2>&1 || die "未找到 podman，请先安装"
    if ! podman compose version >/dev/null 2>&1; then
        die "podman compose 不可用（podman >= 4.9 自带，或安装 podman-compose）"
    fi
    log_ok "podman + podman compose 可用"
}

ensure_data_dirs() {
    if [[ ! -d "${DATA_ROOT}" ]]; then
        log_info "创建数据根 ${DATA_ROOT}（需要 sudo）"
        sudo mkdir -p "${DATA_ROOT}"
        sudo chown "$(id -u):$(id -g)" "${DATA_ROOT}"
    fi
    for d in "${DATA_SUBDIRS[@]}"; do
        local full="${DATA_ROOT}/${d}"
        if [[ ! -d "${full}" ]]; then
            mkdir -p "${full}" 2>/dev/null || sudo mkdir -p "${full}"
        fi
    done
    # postgres 容器需要 999:999 (alpine 镜像) 写权限——若是新建目录则放宽
    if [[ -d "${DATA_ROOT}/pgdata" && -z "$(ls -A "${DATA_ROOT}/pgdata" 2>/dev/null)" ]]; then
        chmod 777 "${DATA_ROOT}/pgdata" 2>/dev/null || sudo chmod 777 "${DATA_ROOT}/pgdata"
    fi
    log_ok "数据目录就绪：${DATA_ROOT}"
}

# ---------- up ----------
wait_postgres_healthy() {
    log_info "等待 postgres healthy..."
    local i=0
    while (( i < HEALTH_TIMEOUT_SECS )); do
        local status
        status="$(podman inspect -f '{{.State.Health.Status}}' aln-postgres 2>/dev/null || echo "unknown")"
        if [[ "${status}" == "healthy" ]]; then
            log_ok "postgres healthy"
            return 0
        fi
        sleep 2
        i=$((i + 2))
    done
    die "postgres 在 ${HEALTH_TIMEOUT_SECS}s 内未变 healthy"
}

run_migrations() {
    log_info "跑 alembic 迁移..."
    # 优先在 api 容器里跑（保证依赖一致），api 还没起时退回本地 uv
    if podman ps --format '{{.Names}}' | grep -q '^aln-api$'; then
        compose exec -T api alembic upgrade head
    else
        # 临时启动 api 容器只跑迁移（--rm 不保留）
        compose run --rm api alembic upgrade head
    fi
    log_ok "alembic 迁移完成"
}

check_frontend_dist() {
    if [[ ! -d "${FRONTEND_DIST}" ]] || [[ -z "$(ls -A "${FRONTEND_DIST}" 2>/dev/null)" ]]; then
        log_error "frontend/dist 不存在或为空"
        log_info  "请先构建前端："
        log_info  "  cd frontend && npm install && npm run build"
        log_info  "再重新运行 ./bootstrap.sh up"
        exit 1
    fi
    log_ok "frontend/dist 已就绪"
}

verify_health() {
    local port
    port="$(get_nginx_port)"
    local url="http://localhost:${port}/api/health"
    log_info "验证 ${url}..."
    local i=0
    while (( i < HEALTH_TIMEOUT_SECS )); do
        if curl -fsS "${url}" >/dev/null 2>&1; then
            log_ok "API 健康检查通过"
            return 0
        fi
        sleep 2
        i=$((i + 2))
    done
    die "API 在 ${HEALTH_TIMEOUT_SECS}s 内未通过健康检查；用 ./bootstrap.sh status 排查"
}

print_access_info() {
    local port
    port="$(get_nginx_port)"
    echo
    log_ok "全部启动完毕"
    echo "      Web 入口： http://localhost:${port}"
    echo "      API 直连： http://localhost:8001"
    echo "      健康检查： http://localhost:${port}/api/health"
    echo
}

cmd_up() {
    check_env_file
    check_podman
    ensure_data_dirs

    log_info "启动 postgres + redis"
    compose up -d postgres redis
    wait_postgres_healthy

    run_migrations

    check_frontend_dist

    log_info "启动 api + worker + nginx"
    compose up -d api worker nginx

    verify_health
    print_access_info
}

# ---------- down ----------
cmd_down() {
    check_env_file
    check_podman
    log_info "停止全部容器"
    compose down
    log_ok "已停止（数据保留在 ${DATA_ROOT}）"
}

# ---------- reset ----------
cmd_reset() {
    check_env_file
    check_podman
    cat <<EOF
${C_RED}========================================
  WARNING: 即将销毁容器 + 全部业务数据
  目录：${DATA_ROOT}/{pgdata,redis,uploads,files,exports}
  此操作不可逆。
========================================${C_RST}
EOF
    printf "输入 RESET 继续，其它任何输入取消： "
    read -r confirm
    if [[ "${confirm}" != "RESET" ]]; then
        log_info "已取消"
        exit 0
    fi

    log_info "停止 + 删除容器"
    compose down -v || true

    log_info "删除业务数据"
    for d in pgdata redis uploads files exports; do
        local full="${DATA_ROOT}/${d}"
        if [[ -d "${full}" ]]; then
            rm -rf "${full}" 2>/dev/null || sudo rm -rf "${full}"
            log_ok "已删 ${full}"
        fi
    done
    log_ok "重置完成。下次 ./bootstrap.sh up 将从空数据库开始"
}

# ---------- status ----------
cmd_status() {
    check_env_file
    check_podman

    log_info "容器状态："
    compose ps || true
    echo

    local port
    port="$(get_nginx_port)"
    log_info "API 健康检查 (http://localhost:${port}/api/health)："
    if curl -fsS "http://localhost:${port}/api/health" 2>/dev/null; then
        echo
        log_ok "健康"
    else
        echo
        log_error "不健康或未启动"
    fi
    echo

    log_info "磁盘 (${DATA_ROOT})："
    df -h "${DATA_ROOT}" 2>/dev/null || log_error "${DATA_ROOT} 不存在"
}

# ---------- 入口 ----------
main() {
    local cmd="${1:-up}"
    case "${cmd}" in
        up)     cmd_up     ;;
        down)   cmd_down   ;;
        reset)  cmd_reset  ;;
        status) cmd_status ;;
        -h|--help|help)
            cat <<EOF
用法：./bootstrap.sh [up|down|reset|status]

  up      启动全部 5 容器（默认）
  down    停止全部容器（保留数据）
  reset   销毁容器 + 删除 ${DATA_ROOT} 业务数据（需二次确认）
  status  查看容器状态 + /api/health + 磁盘

环境变量：
  NO_COLOR=1   关闭彩色输出
EOF
            ;;
        *)
            log_error "未知子命令：${cmd}"
            log_info  "用 ./bootstrap.sh help 查看用法"
            exit 1
            ;;
    esac
}

main "$@"
