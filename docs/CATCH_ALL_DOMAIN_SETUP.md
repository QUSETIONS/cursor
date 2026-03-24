# 🌐 Catch-All 域名邮箱 — 5 分钟速通指南

## 原理

Catch-All（通配收件）= 买一个域名，将 **所有发往该域名的邮件** 统一接收到一个邮箱。
这意味着 `a@你的域名.xyz`、`b@你的域名.xyz`、`99999@你的域名.xyz` 全部到同一个收件箱。

**一个域名 = 无限邮箱，瞬间消灭注册瓶颈。**

---

## 方案一：Cloudflare Email Routing（推荐，免费）

### 步骤 1：购买廉价域名
- 推荐注册商：[Namesilo](https://www.namesilo.com/)、[Spaceship](https://www.spaceship.com/)、[Cloudflare Registrar](https://dash.cloudflare.com/)
- 推荐后缀：`.xyz`（$1/年）、`.top`（$0.99/年）、`.site`（$1/年）
- 注意：避免 `.tk/.ml/.ga` 等免费域名，它们被大多数平台拉黑

### 步骤 2：将域名 NS 指向 Cloudflare
1. 注册 [Cloudflare](https://dash.cloudflare.com/) 账号
2. 添加站点 → 输入购买的域名
3. 按照 Cloudflare 指引，去域名注册商后台，将 **Nameservers** 修改为 Cloudflare 分配的值
4. 等待 10 分钟生效

### 步骤 3：启用 Email Routing（Catch-All）
1. 进入 Cloudflare 面板 → **Email** → **Email Routing**
2. 点击 **Get Started**
3. 添加一个目标转发地址：填入你的 **真实收件邮箱**（Gmail/Outlook 均可）
4. 去目标邮箱确认验证邮件
5. 回到 Cloudflare → **Routing rules** → 点击 **Catch-all address**
6. 设置操作为 **Send to an email** → 选择刚才验证的目标邮箱
7. 保存

### 步骤 4：配置 Nirvana 连接
在 Nirvana 界面的 **设置 → Catch-All 配置**：
```
域名:         你的域名.xyz
IMAP 主机:    imap.gmail.com       (或 outlook.office365.com)
IMAP 端口:    993
IMAP 用户:    你的真实邮箱@gmail.com
IMAP 密码:    Google 应用专用密码    (非登录密码)
```

> ⚠️ **Gmail 用户必须**：开启 2FA → 生成「应用专用密码」用于 IMAP。

---

## 方案二：自建 SMTP/IMAP 服务器（poste.io）

适合有 VPS 的用户，完全自主可控。

### 步骤 1：部署 poste.io
```bash
docker run -d \
  --name mailserver \
  -p 25:25 -p 143:143 -p 993:993 -p 587:587 \
  -v /data/mail:/data \
  -e "HTTPS=OFF" \
  -h mail.你的域名.xyz \
  analogic/poste.io
```

### 步骤 2：配置 DNS
在域名 DNS 中添加：
| 类型 | 名称 | 值 |
|------|------|-----|
| MX   | @    | mail.你的域名.xyz (优先级: 10) |
| A    | mail | 你的VPS IP |

### 步骤 3：创建 Catch-All 收件箱
1. 打开 `http://你的VPS:8080`（poste.io 管理面板）
2. 创建域名、创建一个管理员邮箱
3. 在「虚拟域名」设置中，启用 **Catch-All** → 指向管理邮箱

### 步骤 4：配置 Nirvana
```
域名:         你的域名.xyz
IMAP 主机:    你的VPS IP
IMAP 端口:    993
IMAP 用户:    admin@你的域名.xyz
IMAP 密码:    你设置的密码
```

---

## Docker Worker 环境变量配置

```env
CATCH_ALL_DOMAIN=你的域名.xyz
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=你的真实邮箱@gmail.com
IMAP_PASS=你的应用专用密码
TARGET_PLATFORM=kiro
```

## 验证方法

启动 Worker 后，它会自动生成 `<uuid>@你的域名.xyz` 的邮件地址用于注册。验证码会自动路由到你的真实邮箱，并被 IMAP 轮询抓取。
