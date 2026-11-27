import { ArrowIcon, PlusIcon } from "outline-icons";
import styled from "styled-components";
import { toast } from "sonner";
import { stringToColor } from "@shared/utils/color";
import type RootStore from "~/stores/RootStore";
import { LoginDialog } from "~/scenes/Login/components/LoginDialog";
import TeamNew from "~/scenes/TeamNew";
import TeamLogo from "~/components/TeamLogo";
import {
  createAction,
  createActionWithChildren,
  createExternalLinkAction,
} from "~/actions";
import type { ActionContext, Action, ExternalLinkAction } from "~/types";
import isCloudHosted from "~/utils/isCloudHosted";
import Desktop from "~/utils/Desktop";
import { dialogActionFactory } from "./common";
import { TeamSection } from "../sections";

/**
 * Builds the workspace actions available to the current user.
 *
 * @param context the stores containing available workspaces.
 * @returns the workspace switching actions.
 */
export const switchTeamsList = ({ stores }: { stores: RootStore }) =>
  stores.auth.availableTeams
    ?.filter((session) => isCloudHosted || session.canSwitchInPlace)
    .map<Action | ExternalLinkAction>((session) => {
      const action = {
        id: `switch-${session.id}`,
        name: session.name,
        analyticsName: "Switch workspace",
        section: TeamSection,
        keywords: "change switch workspace organization team",
        icon: (
          <StyledTeamLogo
            alt={session.name}
            model={{
              initial: session.name[0],
              avatarUrl: session.avatarUrl,
              id: session.id,
              color: stringToColor(session.id),
            }}
            size={24}
          />
        ),
        visible: ({ currentTeamId }: ActionContext) =>
          currentTeamId !== session.id,
      };

      if (isCloudHosted) {
        return createExternalLinkAction({
          ...action,
          badge: ({ t }) => (session.isSignedIn ? undefined : t("Logged out")),
          url: session.url,
          target: "_self",
        });
      }

      return createAction({
        ...action,
        perform: async () => {
          try {
            await stores.auth.switchWorkspace(session.id);
          } catch (error) {
            if (error instanceof Error) {
              toast.error(error.message);
            }
          }
        },
      });
    }) ?? [];

export const switchTeam = createActionWithChildren({
  name: ({ t }) => t("Switch workspace"),
  placeholder: ({ t }) => t("Select a workspace"),
  analyticsName: "Switch workspace",
  keywords: "change switch workspace organization team",
  section: TeamSection,
  visible: ({ stores, currentTeamId }) =>
    isCloudHosted
      ? (stores.auth.availableTeams?.length ?? 0) > 1
      : (stores.auth.availableTeams?.some(
          (session) => session.id !== currentTeamId && session.canSwitchInPlace
        ) ?? false),
  children: switchTeamsList,
});

export const createTeam = createAction({
  name: ({ t }) => `${t("New workspace")}…`,
  analyticsName: "New workspace",
  keywords: "create change switch workspace organization team",
  section: TeamSection,
  icon: <PlusIcon />,
  visible: ({ stores, currentTeamId }) =>
    stores.policies.abilities(currentTeamId ?? "").createTeam,
  perform: ({ t, event, stores }) => {
    event?.preventDefault();
    event?.stopPropagation();

    const { user } = stores.auth;
    if (user) {
      stores.dialogs.openModal({
        title: t("Create a workspace"),
        content: <TeamNew user={user} />,
      });
    }
  },
});

export const desktopLoginTeam = dialogActionFactory({
  analyticsName: "Login to workspace",
  section: TeamSection,
  name: (t) => t("Log in to workspace"),
  title: (t) => t("Log in to workspace"),
  content: () => <LoginDialog />,
  icon: <ArrowIcon />,
  keywords: "change switch workspace organization team",
  stopEvent: true,
  visible: () => Desktop.isElectron(),
});

const StyledTeamLogo = styled(TeamLogo)`
  border-radius: 2px;
  border: 0;
`;

export const rootTeamActions = [switchTeam, createTeam, desktopLoginTeam];
