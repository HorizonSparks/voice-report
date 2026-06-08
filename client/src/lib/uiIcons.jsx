// Shared icon language for Voice Report — the LoopFolders look.
//
// Why this file exists: Voice Report historically drew its tiles with emoji (📁 👥 📌 …),
// which reads as a *different, less-finished* product next to LoopFolders' clean line icons.
// LoopFolders (the design we're unifying toward) uses monochrome MUI icons sitting inside a
// soft pastel circular badge. This module is the single source of that language so every
// screen — the field home, the command center, and the deeper-view sweep later — stays
// consistent and can't drift.
//
// Mobile-first note: these are vector icons (crisp at any DPI) in touch-sized 48px badges,
// which is exactly what the iPhone field user needs — not a desktop afterthought.

import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';

import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded';
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded';
import BuildRoundedIcon from '@mui/icons-material/BuildRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';

// Brand-safe pastel tones only (no red — house rule). These mirror LoopFolders' badge palette:
// peach/orange, cyan, mint-green, amber. Charcoal ('secondary') reserved for neutral chrome.
//
// tone -> resolves to theme.palette[tone]. Badge = 16% tint of .main; icon = .main.

export function IconBadge({ icon: Icon, tone = 'primary', size = 48, sx }) {
  const pick = (theme) => theme.palette[tone] || theme.palette.primary;
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: (theme) => alpha(pick(theme).main, 0.16),
        color: (theme) => pick(theme).main,
        ...sx,
      }}
    >
      <Icon sx={{ fontSize: Math.round(size * 0.52) }} />
    </Box>
  );
}

// Field-home action tiles, keyed by the tile id already used in HomeView.getActionTiles().
export const ACTION_ICONS = {
  projects: { Icon: FolderRoundedIcon, tone: 'primary' },
  crew: { Icon: GroupsRoundedIcon, tone: 'info' },
  dailyplan: { Icon: PushPinRoundedIcon, tone: 'warning' },
  reports: { Icon: AssignmentRoundedIcon, tone: 'success' },
  messages: { Icon: ChatRoundedIcon, tone: 'info' },
  forms: { Icon: EditNoteRoundedIcon, tone: 'success' },
};

// Command-center / ops tiles + misc, for the follow-on sweep. Keyed by a stable semantic key.
export const OPS_ICONS = {
  companies: { Icon: BusinessRoundedIcon, tone: 'primary' },
  team: { Icon: GroupsRoundedIcon, tone: 'info' },
  auditLog: { Icon: ReceiptLongRoundedIcon, tone: 'warning' },
  messages: { Icon: ChatRoundedIcon, tone: 'info' },
  support: { Icon: BuildRoundedIcon, tone: 'success' },
  ppe: { Icon: HealthAndSafetyRoundedIcon, tone: 'warning' },
  aiSpending: { Icon: PsychologyRoundedIcon, tone: 'primary' },
  systemHealth: { Icon: InsightsRoundedIcon, tone: 'success' },
  dashboard: { Icon: DashboardRoundedIcon, tone: 'primary' },
  templates: { Icon: DescriptionRoundedIcon, tone: 'info' },
  safety: { Icon: HealthAndSafetyRoundedIcon, tone: 'warning' },
};
