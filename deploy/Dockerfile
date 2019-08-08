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
    sudo

RUN useradd -m keybase && \
    mkdir /keybase && \
    chmod 777 /keybase

RUN echo 'keybase ALL=(ALL) NOPASSWD: ALL' | EDITOR='tee -a' visudo

USER keybase
WORKDIR /home/keybase

RUN git clone https://aur.archlinux.org/keybase-bin.git && \
        cd keybase-bin && \
        makepkg -si --noconfirm

ENV PATH=/home/keybase:$PATH
