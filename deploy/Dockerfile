FROM archlinux/base

RUN pacman -Sy && \
    pacman -S --ask 20 --noconfirm \
    base \
    binutils \
    fakeroot \
    git \
    jq \
    gcc \
    tcl \
    expect \
    nodejs-lts-dubnium \
    npm \
    sudo \
    keybase

RUN useradd -m keybase && \
    mkdir /keybase && \
    chmod 777 /keybase

RUN echo 'keybase ALL=(ALL) NOPASSWD: ALL' | EDITOR='tee -a' visudo

USER keybase
WORKDIR /home/keybase

ENV PATH=/home/keybase:$PATH
