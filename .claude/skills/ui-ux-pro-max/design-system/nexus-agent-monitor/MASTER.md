# Design System Master File - Nexus Agent Monitor

> **Apple-Grade Glassmorphism Design System**
> Quiet Luxury Aesthetic - 极简奢华

**Project:** Nexus Agent Monitor
**Style:** Glassmorphism + Minimalism
**Target Audience:** 普通用户（非技术人员）
**Updated:** 2026-02-15

---

## 核心设计理念

**90% 灰度 + 10% 色彩** - 主要用灰度系统，色彩只用于关键状态
**极致克制** - 不通过"多"展示高级，而是通过"精"传达品质
**艺术品质感** - 每个细节都经过精心打磨

---

## Color Palette - 配色系统

### 背景层次（暖灰系统）

```css
--bg-primary: #FAFAF9;        /* 极浅暖灰 - 主背景，不是纯白 */
--bg-secondary: #F5F5F4;      /* 次级背景 */
--bg-elevated: #FFFFFF;       /* 悬浮元素背景 */
--bg-card: #FFFFFF;           /* 卡片背景 */
```

### 玻璃材质（Glassmorphism）

```css
--glass-bg: rgba(255, 255, 255, 0.7);
--glass-border: rgba(0, 0, 0, 0.06);
--glass-blur: 40px;
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.04),
                0 1px 2px rgba(0, 0, 0, 0.02);
```

### 文字层次（灰度系统）

```css
--text-primary: #1C1917;      /* 炭黑 - 主要文字 */
--text-secondary: #57534E;    /* 中灰 - 次要文字 */
--text-tertiary: #A8A29E;     /* 浅灰 - 辅助文字 */
--text-disabled: #D6D3D1;     /* 禁用状态 */
--text-on-glass: rgba(28, 25, 23, 0.9);
```

### 强调色（极度克制使用）

```css
--accent-primary: #0A0A0A;    /* 深黑 - 主要强调 */
--accent-subtle: #57534E;     /* 柔和强调 */
```

### 状态色（柔和版本 - 不用鲜艳色）

```css
--status-success: #059669;    /* 深绿 - 运行中 */
--status-warning: #D97706;    /* 深橙 - 警告 */
--status-error: #DC2626;      /* 深红 - 错误 */
--status-info: #0284C7;       /* 深蓝 - 信息 */
--status-idle: #78716C;       /* 深灰 - 空闲 */
```

### 状态色背景（极浅版本）

```css
--status-success-bg: rgba(5, 150, 105, 0.08);
--status-warning-bg: rgba(217, 119, 6, 0.08);
--status-error-bg: rgba(220, 38, 38, 0.08);
--status-info-bg: rgba(2, 132, 199, 0.08);
--status-idle-bg: rgba(120, 113, 108, 0.08);
```

### 边框系统

```css
--border-subtle: rgba(0, 0, 0, 0.06);   /* 极细边框 */
--border-medium: rgba(0, 0, 0, 0.1);    /* 中等边框 */
--border-strong: rgba(0, 0, 0, 0.15);   /* 强边框 */
```

---

## Typography - 字体系统

### 字体族

```css
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
--font-mono: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
```

**Google Fonts Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### 字重系统

```css
--font-light: 300;
--font-regular: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### 字号系统（Apple 比例）

```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 2rem;      /* 32px */
```

---

## Spacing - 间距系统

**大量留白** - 元素间距至少 24px 起步

```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
--space-24: 6rem;     /* 96px */
```

---

## Shadows - 阴影系统

**多层微妙阴影** - 营造深度但不突兀

```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.04),
             0 1px 2px rgba(0, 0, 0, 0.02);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.04),
             0 2px 4px rgba(0, 0, 0, 0.02);
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.06),
             0 2px 4px rgba(0, 0, 0, 0.03);
--shadow-xl: 0 12px 24px rgba(0, 0, 0, 0.08),
             0 4px 8px rgba(0, 0, 0, 0.04);
--shadow-2xl: 0 20px 40px rgba(0, 0, 0, 0.1),
              0 8px 16px rgba(0, 0, 0, 0.05);
```

---

## Border Radius - 圆角系统

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 20px;    /* 玻璃卡片使用 */
--radius-2xl: 24px;
--radius-full: 9999px;
```

---

## Transitions - 过渡系统

**慢速过渡（400ms）** - 优雅、从容

```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-elegant: 400ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Component Specs - 组件规范

### Glass Card - 玻璃卡片

```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  transition: all var(--transition-elegant);
}

.glass-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}
```

### Status Indicator - 状态指示器

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--status-success);
  box-shadow: 0 0 0 3px var(--status-success-bg);
}

.status-dot-active {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px var(--status-success-bg);
  }
  50% {
    box-shadow: 0 0 0 6px var(--status-success-bg);
  }
}
```

### Button - 按钮

```css
.btn-primary {
  background: var(--accent-primary);
  color: white;
  padding: 12px 24px;
  border-radius: var(--radius-lg);
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  border: none;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
```

---

## Design Principles - 设计原则

1. **90% 灰度 + 10% 色彩** - 主要用灰度系统，色彩只用于关键状态
2. **大圆角（20px）** - 柔和、友好
3. **极细边框（1px）** - 精致、克制
4. **多层微妙阴影** - 营造深度但不突兀
5. **大量留白** - 元素间距至少 24px 起步
6. **慢速过渡（400ms）** - 优雅、从容
7. **强模糊（40px）** - 玻璃质感的关键

---

## Anti-Patterns - 禁止使用

- ❌ **鲜艳色彩** - 不用 #00FF00、#FF00FF 等霓虹色
- ❌ **纯黑纯白** - 用暖灰系统代替
- ❌ **硬边框** - 用微妙的 rgba 边框
- ❌ **快速动画** - 不用 < 200ms 的过渡
- ❌ **Emojis as icons** - 用 SVG 图标
- ❌ **Layout-shifting hovers** - 避免 scale 变换
- ❌ **低对比度文字** - 保持 4.5:1 最小对比度

---

## Reference - 参考对象

- **Apple Vision Pro UI** - 玻璃材质的极致
- **Linear** - 极简主义的典范
- **Arc Browser** - 现代优雅的设计
- **Stripe Dashboard** - 专业而精致

---

## Pre-Delivery Checklist

- [ ] 所有图标使用 SVG（Heroicons/Lucide）
- [ ] 所有可点击元素有 cursor:pointer
- [ ] 悬停状态有平滑过渡（200-400ms）
- [ ] 文字对比度 ≥ 4.5:1
- [ ] 焦点状态可见（键盘导航）
- [ ] 支持 prefers-reduced-motion
- [ ] 响应式：375px, 768px, 1024px, 1440px
- [ ] 无横向滚动
- [ ] 玻璃效果在所有浏览器正常显示
