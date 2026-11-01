/* main.tsx —— 挂载点。单独一个文件是为了让 esbuild 的入口保持稳定:
 * 组件拆分/改名时入口路径不变, www/ 里的产物名也不变。 */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const el = document.getElementById("root");
if (!el) throw new Error("缺少 #root 挂载点(检查 www/index.html)");

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
