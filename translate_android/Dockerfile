FROM ubuntu:20.04

# 避免交互式配置
ENV DEBIAN_FRONTEND=noninteractive

# 安装系统依赖
RUN apt-get update && apt-get install -y     python3-pip     python3-setuptools     git     zip     unzip     openjdk-8-jdk     build-essential     libffi-dev     libssl-dev     libsqlite3-dev     pkg-config     libjpeg-dev     libbz2-dev     libexpat1-dev     libgdbm-dev     libncurses5-dev     libreadline-dev     zlib1g-dev     libffi-dev     liblzma-dev     python3-dev     && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
RUN pip3 install --no-cache-dir buildozer cython kivy numpy openai sounddevice soundfile

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 设置环境变量
ENV PATH=$PATH:/root/.local/bin

# 构建命令
CMD ["buildozer", "android", "debug"]
