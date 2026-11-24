import { createRoot } from "react-dom/client";
import "./styles.css";
import { BenchmarkPage } from "./pages/BenchmarkPage";
createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", overflow: "auto" }}><BenchmarkPage settings={(window as any).__settings} onGo={() => {}} /></div>);
