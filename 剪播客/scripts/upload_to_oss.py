#!/usr/bin/env python3
"""
上传文件到阿里云OSS
用法: python3 upload_to_oss.py <本地文件路径>
"""

import sys
import os
from datetime import datetime
import oss2

def upload_to_oss(local_file):
    # 从环境变量读取配置
    access_key_id = os.environ.get('OSS_ACCESS_KEY_ID')
    access_key_secret = os.environ.get('OSS_ACCESS_KEY_SECRET')
    endpoint = os.environ.get('OSS_ENDPOINT')
    bucket_name = os.environ.get('OSS_BUCKET_NAME')

    if not all([access_key_id, access_key_secret, endpoint, bucket_name]):
        print("❌ 错误：未设置OSS环境变量")
        print("需要设置: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT, OSS_BUCKET_NAME")
        sys.exit(1)

    if not os.path.exists(local_file):
        print(f"❌ 错误：文件不存在 {local_file}")
        sys.exit(1)

    # 初始化OSS
    auth = oss2.Auth(access_key_id, access_key_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)

    # 生成OSS对象名（带时间戳避免冲突）
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.basename(local_file)
    object_name = f"podcast_audio/{timestamp}_{filename}"

    # 上传文件
    print(f"🚀 开始上传到阿里云OSS...")
    print(f"   本地文件: {local_file}")
    print(f"   文件大小: {os.path.getsize(local_file) / 1024 / 1024:.2f} MB")
    print(f"   OSS对象: {object_name}")
    print()

    # 使用进度条上传
    uploaded_size = [0]
    total_size = os.path.getsize(local_file)

    def progress_callback(consumed_bytes, total_bytes):
        if total_bytes:
            percent = int(100 * consumed_bytes / total_bytes)
            if consumed_bytes - uploaded_size[0] > total_size / 20:  # 每5%打印一次
                print(f"   上传进度: {percent}% ({consumed_bytes / 1024 / 1024:.2f} MB / {total_bytes / 1024 / 1024:.2f} MB)")
                uploaded_size[0] = consumed_bytes

    try:
        bucket.put_object_from_file(object_name, local_file, progress_callback=progress_callback)
        print()
        print("✅ 上传完成！")

        # 生成公网URL（需要bucket设置为公共读）
        url = f"https://{bucket_name}.{endpoint}/{object_name}"
        print(f"   公网URL: {url}")
        print()

        # 保存URL到文件
        with open('audio_url.txt', 'w') as f:
            f.write(url)
        print("   URL已保存到: audio_url.txt")

        return url

    except Exception as e:
        print(f"❌ 上传失败: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python3 upload_to_oss.py <本地文件路径>")
        sys.exit(1)

    local_file = sys.argv[1]
    upload_to_oss(local_file)
