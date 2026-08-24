# Citshe Executor — isolated environment for AI coding threads
#
# Two variants:
#   docker build --target lite -t citshe-executor:lite .   (terminal only, ~2GB)
#   docker build --target full -t citshe-executor:latest . (terminal + Chrome + browser streaming)

# ============================================================================
# BASE — shared foundation for both variants
# ============================================================================
FROM node:22-bookworm AS base

LABEL maintainer="citshe"
LABEL description="Isolated execution environment for citshe threads"

ENV DEBIAN_FRONTEND=noninteractive

# System dependencies
RUN apt-get update && apt-get install -y \
    git git-lfs \
    curl wget httpie jq \
    build-essential gcc g++ make cmake \
    python3 python3-pip python3-venv \
    bash zsh vim nano less tree htop \
    tmux \
    zip unzip tar gzip \
    ca-certificates openssl \
    procps dnsutils openssh-client rsync \
    locales sudo \
    && rm -rf /var/lib/apt/lists/*

# Locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8

# Put the executor's ~/bin on PATH so installed helpers (e.g. citshe-task,
# which lets the agent add tasks to the board) are callable by name.
ENV PATH="/home/executor/bin:${PATH}"

# AI agent CLIs
RUN npm install -g @anthropic-ai/claude-code openclaw@latest

# Common npm tools
RUN npm install -g \
    typescript ts-node tsx pnpm \
    eslint prettier jest vitest \
    nodemon pm2 rimraf dotenv-cli

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# GitLab CLI
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v1.46.1/downloads/glab_1.46.1_linux_${ARCH}.deb" -o /tmp/glab.deb && \
    dpkg -i /tmp/glab.deb && rm /tmp/glab.deb \
    || echo "glab installation failed, skipping..."

# Jira CLI
RUN ARCH=$(dpkg --print-architecture) && \
    GOARCH=$([ "$ARCH" = "amd64" ] && echo "amd64" || echo "arm64") && \
    curl -fsSL "https://github.com/ankitpokhrel/jira-cli/releases/latest/download/jira_linux_${GOARCH}.tar.gz" -o /tmp/jira.tar.gz && \
    tar -xzf /tmp/jira.tar.gz -C /usr/local/bin jira && chmod +x /usr/local/bin/jira && rm /tmp/jira.tar.gz \
    || echo "jira-cli installation failed, skipping..."

# Docker CE + Compose (for DinD)
RUN curl -fsSL https://get.docker.com | sh
RUN mkdir -p /usr/local/lib/docker/cli-plugins && \
    ARCH=$(uname -m) && \
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose && \
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Non-root user
RUN useradd -m -s /bin/bash -G sudo,docker executor \
    && echo "executor ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Directories
RUN mkdir -p /workspace && chown executor:executor /workspace
RUN mkdir -p /task && chown executor:executor /task
RUN mkdir -p /runner && chown executor:executor /runner

# NOTE: the workflow-runner / session-server COPY + build used to live HERE, in
# `base`, before all the heavy layers (Chrome, Playwright, VNC in `full`). That
# meant every edit to session-server/server.js busted the cache for ~1.9GB of
# downstream layers → ~12min rebuilds. They now live at the END of the `lite`
# and `full` stages (after the heavy layers), so a session-server change
# rebuilds only a few small layers in seconds.

# tmux config — terminals are tmux windows in one shared "citshe" session, so
# multiple citshe clients can attach to the same window (watch + take over).
# aggressive-resize + window-size latest keep the pane sized to the newest
# client instead of the smallest; escape-time 0 avoids key lag.
RUN printf '%s\n' \
    'set -g escape-time 0' \
    'set -g history-limit 50000' \
    'set -g mouse on' \
    'setw -g aggressive-resize on' \
    'set -g window-size latest' \
    'set -g status off' \
    'set -g default-terminal "xterm-256color"' \
    > /etc/tmux.conf

# Git config
USER executor
# Default commit identity — the "3uba" GitHub no-reply, so commits attribute to
# a real GitHub user (Vercel etc. reject placeholder authors). The session
# server overrides this from GIT_AUTHOR_NAME/EMAIL at setup when provided.
RUN git config --global init.defaultBranch main \
    && git config --global pull.rebase false \
    && git config --global user.email "75246355+3uba@users.noreply.github.com" \
    && git config --global user.name "3uba"

# ============================================================================
# HEAVY-FULL — adds Chrome, Playwright, Xvfb, VNC, noVNC for browser streaming.
# This stage holds the big, rarely-changing downloads so app code (below) can
# sit on top of it and stay cached across session-server edits.
# ============================================================================
FROM base AS heavy-full

USER root

# Google Chrome
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && \
    apt-get update && apt-get install -y /tmp/chrome.deb && \
    rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/* \
    || echo "Chrome installation failed (arm64?), skipping..."

# Playwright system deps
RUN npx playwright install-deps chromium

# Display server + VNC
RUN apt-get update && apt-get install -y \
    xvfb x11vnc fluxbox \
    && rm -rf /var/lib/apt/lists/*

# noVNC
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/novnc \
    && git clone --depth 1 https://github.com/novnc/websockify.git /opt/novnc/utils/websockify \
    && ln -s /opt/novnc/vnc.html /opt/novnc/index.html

# Playwright Chromium (as executor)
USER executor
RUN npx playwright install chromium

# ============================================================================
# APP CODE — the workflow-runner + session-server. Added at the END of each
# target (after the heavy layers) so editing session-server/server.js only
# rebuilds these small layers, not Chrome/Playwright/VNC. Duplicated in lite +
# full because Docker stages can't share trailing instructions.
# ============================================================================

# ---- LITE: terminal only, no browser/GUI (~2GB smaller) --------------------
FROM base AS lite
USER root
COPY --chown=executor:executor workflow-runner /runner
COPY --chown=executor:executor session-server /session
WORKDIR /runner
RUN npm install && npm run build
WORKDIR /workspace
USER executor

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node --version && git --version && claude --version || exit 1

ENTRYPOINT ["node", "/runner/dist/runner.js"]
CMD []

# ---- FULL: heavy-full + app code -------------------------------------------
FROM heavy-full AS full
USER root
COPY --chown=executor:executor workflow-runner /runner
COPY --chown=executor:executor session-server /session
WORKDIR /runner
RUN npm install && npm run build
WORKDIR /workspace
USER executor

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node --version && git --version && claude --version || exit 1

ENTRYPOINT ["node", "/runner/dist/runner.js"]
CMD []
