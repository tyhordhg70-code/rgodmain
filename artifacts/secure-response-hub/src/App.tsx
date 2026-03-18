import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RetailProvider } from "@/context/RetailContext";
import HomePage from "@/pages/HomePage";
import FormPage from "@/pages/FormPage";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import FormEditorPage from "@/pages/FormEditorPage";
import RetailDashboard from "@/pages/retail/RetailDashboard";
import RetailOrders from "@/pages/retail/RetailOrders";
import RetailSessions from "@/pages/retail/RetailSessions";
import RetailMerchants from "@/pages/retail/RetailMerchants";
import RetailActivity from "@/pages/retail/RetailActivity";
import RetailSettings from "@/pages/retail/RetailSettings";
import NotFound from "@/pages/not-found";

type AuthCheckResult = {
  authenticated: boolean;
  encryptionKey?: string;
};

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data, isLoading } = useQuery<AuthCheckResult>({
    queryKey: ["/api/auth/check"],
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data?.authenticated) {
    const from = location !== "/login" ? encodeURIComponent(location) : "";
    return <Redirect to={from ? `/login?from=${from}` : "/login"} />;
  }

  if (data.encryptionKey && !sessionStorage.getItem("dk")) {
    sessionStorage.setItem("dk", data.encryptionKey);
  }

  return <>{children}</>;
}

function RetailApp() {
  return (
    <AuthGuard>
      <RetailProvider>
        <Switch>
          <Route path="/retail" component={RetailDashboard} />
          <Route path="/retail/orders" component={RetailOrders} />
          <Route path="/retail/sessions" component={RetailSessions} />
          <Route path="/retail/merchants" component={RetailMerchants} />
          <Route path="/retail/activity" component={RetailActivity} />
          <Route path="/retail/settings" component={RetailSettings} />
        </Switch>
      </RetailProvider>
    </AuthGuard>
  );
}

function Router() {
  const [location] = useLocation();
  const isRetail = location.startsWith("/retail");

  if (isRetail) {
    return <RetailApp />;
  }

  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/form" component={FormPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard">
        <AuthGuard>
          <DashboardPage />
        </AuthGuard>
      </Route>
      <Route path="/form-editor">
        <AuthGuard>
          <FormEditorPage />
        </AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Toaster />
          <SonnerToaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#0f172a",
                border: "1px solid #1e293b",
                color: "#f8fafc",
              },
            }}
          />
          <Router />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
