import { BrowserRouter as Router } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { UploadProvider } from "./context/UploadContext";
import { AuthProvider } from "./context/AuthContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { LocaleProvider } from "./context/LocaleProvider";
import { AppRoutes } from "./AppRoutes";

function App() {
  return (
    <Router>
      <AuthProvider>
        <PreferencesProvider>
          <LocaleProvider>
            <ThemeProvider>
              <UploadProvider>
                <AppRoutes />
              </UploadProvider>
            </ThemeProvider>
          </LocaleProvider>
        </PreferencesProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
