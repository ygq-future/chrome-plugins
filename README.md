# Chrome Plugins

Chrome 浏览器扩展集合，所有插件均通过开发者模式加载使用。

## 插件列表

### AI 划词翻译 (`ai-translator/`)

划词翻译工具，选中文本即可翻译，支持任意 OpenAI 兼容 API。

**功能**
- 划词翻译：选中文本 → 弹出翻译按钮 → 点击查看结果
- 翻译面板：独立面板，支持双向翻译、语言切换、清空/复制
- 快捷键 `Alt+Shift+T`（macOS: `Cmd+Shift+T`）打开面板
- 支持 OpenAI / DeepSeek / Groq / Gemini 等兼容接口
- 面板模式可选：模态框（固定居中）或浮动窗口（可拖动，可选中页面文字）
- 自定义面板尺寸、目标语言、关闭方式

**配置**
1. 点击浏览器工具栏的插件图标，打开设置弹窗
2. 填写 API Base URL、API Key、模型名称
3. 设置目标语言、面板模式等偏好
4. 点击「保存设置」

---

## 安装方式（开发者模式）

所有插件均以 Chrome 开发者模式加载，无需打包。

1. 克隆或下载本仓库到本地
2. 打开 Chrome，地址栏输入 `chrome://extensions` 并回车
3. 打开右上角的 **「开发者模式」** 开关
4. 点击 **「加载已解压的扩展程序」**
5. 选择对应的插件目录（例如 `ai-translator/`）
6. 插件图标出现在浏览器工具栏，即可使用

**更新插件**：修改代码后，回到 `chrome://extensions`，点击插件卡片右下角的刷新按钮。

---

## 目录结构

```
chrome-plugins/
├── ai-translator/          # AI 划词翻译
│   ├── manifest.json       # 扩展配置
│   ├── src/                # 源代码
│   │   ├── background.js   # Service Worker
│   │   ├── content.js      # 内容脚本
│   │   ├── content.css     # 注入样式
│   │   ├── popup.html      # 设置弹窗
│   │   └── popup.js        # 设置逻辑
│   └── icons/              # 图标
├── LICENSE                 # Apache 2.0
└── README.md
```

## 自定义快捷键

1. 打开 `chrome://extensions/shortcuts`
2. 找到「AI 划词翻译」，修改 `Alt+Shift+T` 为你习惯的快捷键

## 许可

[Apache License 2.0](LICENSE)
