apt update && apt upgrade -y

apt install -y \
    unzip \
    git

export HOME=/root

curl -fsSL https://bun.sh/install | bash
PATH="$HOME/.bun/bin:$PATH"

git clone https://github.com/HotariTobu/prototype-name-that-tune.git /app
cd /app || exit 1

bun install

export NODE_ENV=production
bun src/index.ts
