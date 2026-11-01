# lume-a2a — 双节点 A2A 演示的容器镜像
#
# ══ 为什么是 alpine 而不是 debian:12-slim ═══════════════════════════════
# 之前用 debian:12-slim, 镜像 121MB, 其中 97MB 是基础镜像本身
# (libc6 23MB + coreutils 20MB + util-linux 8MB + perl-base 8MB + bash 7MB…),
# 项目自己的代码只有 0.3MB。也就是说 99.7% 的体积与本项目无关。
#
# 实测对照(同一份代码、同一个 lume 静态二进制):
#   debian:12-slim     121MB
#   scratch            4.8MB   ← 但**跑不了模型调用**, 见下
#   alpine:3.20       19.8MB   ← 选这个
#
# ══ 为什么不用 scratch ═══════════════════════════════════════════════════
# lume 二进制本身是完全静态的(ldd 显示 "not a dynamic executable"),
# 所以 scratch 能把它跑起来 —— 我实测过, /api/state、工具注册都正常。
# 但**模型调用会失败**: agent.c:471 用 `execlp("curl", ...)` 把模型请求
# 交给 curl 子进程(TLS 由 curl 负责, 服务器本身不链接 OpenSSL —— 这是
# 项目规则)。scratch 里没有 curl, 表现为:
#     [agent] upstream failed (curl exit 7)
# exit 7 = 找不到命令。而这条链路是「问 Agent」页的全部依赖。
#
# 把 curl 塞进 scratch 需要带 33 个动态依赖(libssl/libcrypto/libnghttp2/
# libidn2/libpsl/libunistring/libbrotli/libzstd/libcares/libz…), 体积会超过
# alpine 且需要手维护依赖清单 —— 每次 curl 升级都要对一遍 so 版本号。
# alpine 有包管理, 一行 apk add 就够。
#
# ══ 为什么还要 curl 之外的什么 ═══════════════════════════════════════════
#   curl             模型调用(必需, 见上)
#   ca-certificates  TLS 根证书(没有它 curl 连不上 https)
#   tzdata           时间戳。容器默认 UTC, 而业务数据都是本地日期
#
# 前端: www/ 是仓库里 build 好的 bundle, 直接 COPY, 镜像里不装 node/esbuild。
# 二进制: 优先用宿主预下载的静态包(vendor/), 绕开容器内 curl 走网关被截断的问题。
ARG LUME_VERSION=v0.12.1
ARG LUME_REPO=erishen/lume
FROM alpine:3.20

ARG TARGETARCH
ARG LUME_VERSION
ARG LUME_REPO

RUN apk add --no-cache curl ca-certificates tzdata

COPY vendor/ /vendor-src/

RUN set -eux; \
    arch="${TARGETARCH:-}"; \
    if [ -z "${arch}" ]; then \
      if [ -f "/vendor-src/lume-linux-arm64-static.tar.gz" ]; then arch=arm64; \
      elif [ -f "/vendor-src/lume-linux-x64-static.tar.gz" ]; then arch=x64; fi; \
    fi; \
    case "${arch}" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "cannot determine target arch (TARGETARCH='${TARGETARCH}')" >&2; ls -la /vendor-src >&2; exit 1 ;; \
    esac; \
    install_lume() { \
      mkdir -p /opt/lume; \
      tar -xzf /tmp/lume.tar.gz -C /opt/lume; \
      bin=$(find /opt/lume -type f -name 'lume' ! -name '*.tmp' | head -1); \
      [ -n "${bin}" ] || { echo "lume binary not found in tarball" >&2; exit 1; }; \
      install -m 0755 "${bin}" /usr/local/bin/lume; \
      rm -rf /opt/lume; \
    }; \
    if [ -f /vendor-src/.lume-version ]; then \
      stamp=$(head -n1 /vendor-src/.lume-version | tr -d '[:space:]'); \
      if [ "${stamp}" != "${LUME_VERSION}" ]; then \
        echo "vendor/ 是 ${stamp}, 但 LUME_VERSION=${LUME_VERSION}" >&2; exit 1; \
      fi; \
    fi; \
    src="/vendor-src/lume-linux-${arch}-static.tar.gz"; \
    sha="/vendor-src/lume-linux-${arch}-static.sha"; \
    if [ -f "${src}" ]; then \
      echo "==> using host-provisioned ${src}"; \
      cp "${src}" /tmp/lume.tar.gz; \
      if [ -f "${sha}" ]; then hex=$(awk 'NR==1{print $1}' "${sha}"); \
        echo "${hex}  /tmp/lume.tar.gz" | sha256sum -c -; fi; \
      install_lume; \
    else \
      echo "==> downloading lume ${arch} in-container"; \
      dl="https://github.com/${LUME_REPO}/releases/download/${LUME_VERSION}"; \
      curl -fsSL --retry 3 --retry-delay 2 -o /tmp/lume.tar.gz "${dl}/lume-linux-${arch}-static.tar.gz"; \
      install_lume; \
    fi; \
    rm -rf /vendor-src /tmp/lume.tar.gz; \
    /usr/local/bin/lume --version

WORKDIR /app

# 布局必须与源码里的相对路径一致(容器 CWD=/app):
#   docroot = "./www"                 → /app/www
#   import "src/a2a.lume"             → /app/src
#   import "../lume-core/lib/peer.lume" → /lume-core/lib  (必须在根目录!)
# 最后一条最容易漏: 平铺到 /app/lume-core 会让 import 解析失败, 而报错文案是
# "cannot resolve import", 看起来像文件没拷进去。
# 注意: scripts/ **不进镜像**。那是宿主侧的开发与验收工具
# (probe/seed/check_public), 与运行时无关。
COPY node.lume ./
COPY src/ ./src/
COPY www/ ./www/

# ── lume-core/lib: 从 release 取, 不复制源码树 ─────────────────────────
# peer.lume 等 10 个模块是 **.lume 源码**, 不编进二进制 —— 解释器在
# `import` 时按路径读。所以它们必须作为文件出现在 /lume-core/lib。
#
# 以前是从宿主的 ../lume-core/lib 复制进 .runtime/ 再 COPY 进来。问题是
# 那份副本没有任何版本标记, lume-core 更新后它不会自己变 —— 镜像里放着
# 13KB 的旧 peer.lume、源码已是 17KB, 而症状只是
#   module 'peer' has no export 'config_warnings'
# 指向调用点, 指向不到那份旧文件。
#
# 现在按版本从 release 取(v0.12.1 起发布包带 lib/), 版本可查、可复现。
# 校验 sha256: 下载被截断时 build 会失败, 而不是装进半份源码。
ARG LUME_CORE_VERSION=v0.12.1
ARG LUME_CORE_REPO=erishen/lume-core
# TARGETARCH 是 amd64|arm64, 发布资产命名是 x64|arm64 —— 需要转一次。
# 注意 RUN 里不能写行内注释: 续行时 # 会被当作参数传给下一条命令。
RUN set -eux; \
    case "${TARGETARCH:-arm64}" in \
      amd64) carch=x64 ;; \
      arm64) carch=arm64 ;; \
      *) echo "unsupported TARGETARCH='${TARGETARCH}'" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/${LUME_CORE_REPO}/releases/download/${LUME_CORE_VERSION}"; \
    asset="lume-core-linux-${carch}"; \
    curl -fsSL --retry 3 --retry-delay 2 -o /tmp/core.tar.gz "${base}/${asset}.tar.gz"; \
    curl -fsSL --retry 3 -o /tmp/core.sha256 "${base}/${asset}.sha256"; \
    (cd /tmp && sed "s|${asset}.tar.gz|core.tar.gz|" core.sha256 | sha256sum -c -); \
    mkdir -p /tmp/core && tar -xzf /tmp/core.tar.gz -C /tmp/core; \
    mkdir -p /lume-core; \
    cp -r "/tmp/core/${asset}/lib" /lume-core/lib; \
    test -f /lume-core/lib/peer.lume; \
    rm -rf /tmp/core /tmp/core.tar.gz /tmp/core.sha256

# 任务文件按节点名分目录, 写在 /app/.data 下 —— 声明成卷, 容器重建不丢任务。
VOLUME ["/app/.data"]

ENV PEER_BIND=0.0.0.0 \
    PEER_PORT=18190

EXPOSE 18190

# 健康检查走 /api/state(本机可读、不需要签名), 正好也验证了 docroot 与 API 都活着。
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
    CMD curl -sS -f -o /dev/null "http://127.0.0.1:${PEER_PORT}/api/state" || exit 1

CMD ["/usr/local/bin/lume", "node.lume"]
