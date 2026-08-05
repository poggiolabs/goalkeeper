import { useEffect, useState } from "react";
import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  UserRoundIcon
} from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { logout, switchOrganization } from "@/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoMark } from "@/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";
import {
  initials,
  navigationRoutes,
  settingsGroups,
  settingsRoutes
} from "@/lib/app-data";
import { apiUrl } from "@/lib/config";

export function AppShell() {
  return (
    <SidebarProvider>
      <ShellContent />
    </SidebarProvider>
  );
}

function ShellContent() {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const [lastAppPath, setLastAppPath] = useState("/home");
  const [accountError, setAccountError] = useState<string | null>(null);
  const isSettingsRoute = location.pathname.startsWith("/settings/");

  useEffect(() => {
    setOpenMobile(false);
    if (
      !isSettingsRoute &&
      location.pathname !== "/organizations/new" &&
      location.pathname !== "/account"
    ) {
      setLastAppPath(location.pathname);
    }
  }, [isSettingsRoute, location.pathname, setOpenMobile]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 justify-center border-b">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                tooltip="Goalkeeper"
                className="hover:bg-transparent hover:text-sidebar-foreground"
              >
                <Link to="/home">
                  <LogoMark className="size-8!" />
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">Goalkeeper</span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {isSettingsRoute ? (
            <SettingsNavigation backHref={lastAppPath} />
          ) : (
            <MainNavigation />
          )}
        </SidebarContent>

        <SidebarSeparator />
        <SidebarFooter>
          {accountError ? (
            <Alert variant="destructive" className="group-data-[collapsible=icon]:hidden">
              <AlertDescription>{accountError}</AlertDescription>
            </Alert>
          ) : null}
          <AccountMenu onError={setAccountError} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <SidebarTrigger />
          <div className="h-4 w-px bg-border" />
          <span className="text-sm font-medium">
            {pageLabel(location.pathname)}
          </span>
        </header>
        <div className="flex-1 px-5 py-8 md:px-10 md:py-12">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </>
  );
}

function MainNavigation() {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {navigationRoutes.map((route) => {
            const Icon = route.icon;
            return (
              <SidebarMenuItem key={route.href}>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === route.href}
                  tooltip={route.label}
                >
                  <Link to={route.href} onClick={() => setOpenMobile(false)}>
                    <Icon />
                    <span>{route.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SettingsNavigation({ backHref }: { backHref: string }) {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to app">
                <Link to={backHref} onClick={() => setOpenMobile(false)}>
                  <span aria-hidden="true">←</span>
                  <span>Back to app</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {settingsGroups.map((group) => (
        <SidebarGroup key={group}>
          <SidebarGroupLabel>{group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsRoutes
                .filter((route) => route.group === group)
                .map((route) => {
                  const Icon = route.icon;
                  return (
                    <SidebarMenuItem key={route.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname === route.href}
                        tooltip={route.label}
                      >
                        <Link
                          to={route.href}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon />
                          <span>{route.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

function AccountMenu({ onError }: { onError: (error: string | null) => void }) {
  const auth = useAuth();
  const { session } = auth;
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<
    string | null
  >(null);
  const displayName = session?.user.displayName ?? "Account";
  const activeOrganization = session?.organizations.find(
    ({ id }) => id === session.activeOrganizationId
  );

  async function handleLogout() {
    setIsLoggingOut(true);
    onError(null);
    try {
      window.location.assign(await logout(apiUrl));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Unable to log out.");
      setIsLoggingOut(false);
    }
  }

  async function handleOrganizationSwitch(organizationId: string) {
    if (organizationId === session?.activeOrganizationId) return;
    setSwitchingOrganizationId(organizationId);
    onError(null);
    try {
      await switchOrganization(apiUrl, organizationId);
      await auth.refresh();
      setOpenMobile(false);
      await navigate({ to: "/home", replace: true });
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : "Unable to switch organization."
      );
      setSwitchingOrganizationId(null);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border border-sidebar-border bg-background shadow-sm data-[state=open]:bg-sidebar-accent"
              tooltip={displayName}
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                  {initials(displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeOrganization?.name ?? "Organization"}
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "top" : "right"}
            sideOffset={8}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Switch organization
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {session?.organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  disabled={switchingOrganizationId !== null}
                  className="gap-2 py-2"
                  onSelect={(event) => {
                    if (organization.id === session.activeOrganizationId) return;
                    event.preventDefault();
                    void handleOrganizationSwitch(organization.id);
                  }}
                >
                  <span className="flex size-7 items-center justify-center rounded-md border bg-background">
                    <Building2Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {organization.name}
                    </span>
                    <span className="block text-xs capitalize text-muted-foreground">
                      {switchingOrganizationId === organization.id
                        ? "Switching…"
                        : organization.role}
                    </span>
                  </span>
                  {organization.id === session.activeOrganizationId ? (
                    <CheckIcon className="size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem asChild>
                <Link
                  to="/organizations/new"
                  onClick={() => setOpenMobile(false)}
                >
                  <PlusIcon />
                  New organization
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  to="/settings/profile"
                  onClick={() => setOpenMobile(false)}
                >
                  <UserRoundIcon />
                  Personal settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to="/settings/organization"
                  onClick={() => setOpenMobile(false)}
                >
                  <SettingsIcon />
                  Organization settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isLoggingOut}
              onSelect={(event) => {
                event.preventDefault();
                void handleLogout();
              }}
            >
              <LogOutIcon />
              {isLoggingOut ? "Logging out…" : "Log out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function pageLabel(pathname: string): string {
  if (pathname === "/goals") return "Goals";
  if (pathname === "/settings/profile") return "Profile";
  if (pathname === "/settings/appearance") return "Appearance";
  if (pathname === "/settings/organization") return "Organization";
  if (pathname === "/settings/team") return "Team";
  if (pathname === "/settings/api-tokens") return "API Tokens";
  if (pathname === "/organizations/new") return "New organization";
  return "Home";
}
