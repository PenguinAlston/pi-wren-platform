"""用户认证：PBKDF2 口令 + HMAC 签名会话 Cookie。

设计目标：零第三方依赖（标准库 hashlib/hmac），适合内网试点；
接入 OIDC 时替换 routers/auth.py 的登录实现即可，中间件与会话归属逻辑不变。
"""
