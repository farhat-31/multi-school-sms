import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth";
import { initialSource, SourceContext, type Source } from "./data";
import { App } from "./App";
import { ErrorBoundary, FeedbackProvider } from "./components/feedback";
import "./styles.css";

function Root() {
  const [source, setSourceState] = useState<Source>(initialSource);
  const setSource = (s: Source) => {
    setSourceState(s);
    try {
      localStorage.setItem("dataSource", s);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <SourceContext.Provider value={{ source, setSource }}>
      <AuthProvider>
        <FeedbackProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </FeedbackProvider>
      </AuthProvider>
    </SourceContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
