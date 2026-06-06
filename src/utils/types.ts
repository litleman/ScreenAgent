export type ElementType =
  | 'button' | 'input' | 'link' | 'checkbox' | 'radio' | 'combo'
  | 'slider' | 'text' | 'text_block' | 'image' | 'list' | 'table' | 'tree'
  | 'dialog' | 'window' | 'pane' | 'menu' | 'title' | 'scrollbar'
  | 'unknown'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInfo {
  id: string
  title: string
  processName: string
  bounds: Bounds
  isMinimized: boolean
  isMaximized: boolean
  isFocused: boolean
  isDialog?: boolean
  blockedBy?: string | null
  zOrder: number
}

export interface DialogInfo {
  id: string
  title: string
  blocksWindowId?: string | null
}

export interface MenuItemInfo {
  id: string
  label: string
  controlType: string
  bounds: Bounds
  center: { x: number; y: number }
  isEnabled: boolean
  isVisible: boolean
  hasSubMenu: boolean
  windowId?: string
}

export interface ScreenElement {
  id: string
  label: string
  type: ElementType
  bounds: Bounds
  center: { x: number; y: number }
  isEnabled: boolean
  isVisible: boolean
  isFocused: boolean
  value?: string
  description?: string
  className?: string
  automationId?: string
  source: 'ocr' | 'uia'
  confidence?: number
  windowId?: string
  parentId?: string
  childIds?: string[]
}

export interface ScreenState {
  timestamp: string
  focusedApp: string | null
  focusedWindowId: string | null
  windows: WindowInfo[]
  elements: ScreenElement[]
  isLoading: boolean
  loadingIndicators: string[]
  screenshotPath: string | null
}

export interface VisionSidecarResult {
  success: boolean
  elements: ScreenElement[]
  screenshotPath: string | null
  windows?: WindowInfo[]
  error?: string
  duration: number
}

export interface UiaResult {
  success: boolean
  elements: ScreenElement[]
  windows?: WindowInfo[]
  dialogWindows?: DialogInfo[]
  menuItems?: MenuItemInfo[]
  focusedApp: string | null
  focusedWindow: string | null
  windowBounds: Bounds | null
  error?: string
}

export type VerificationLevel = 'element' | 'window' | 'system'

export interface VerifyResult {
  passed: boolean
  level: VerificationLevel
  confidence: number
  actualLabel?: string
  expectedLabel?: string
  mismatch?: string
  details: string[]
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

export interface ClickValidation {
  safe: boolean
  riskLevel: RiskLevel
  warnings: string[]
  suggestedX?: number
  suggestedY?: number
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[]
  isError?: boolean
}>

export type InputBackend = 'sendinput' | 'pyautogui' | 'directinput' | 'auto'

export type MovementStyle = 'bezier' | 'direct' | 'human'

export type MoveSpeed = 'slow' | 'medium' | 'fast' | 'instant'

export interface MovementProfile {
  style: MovementStyle
  speed: MoveSpeed
  overshootChance: number
  jitterAmount: number
  controlPointSpread: number
}

export interface ClickVerificationResult {
  verified: boolean
  method: 'screenshot_diff' | 'color_change' | 'focus_check' | 'none'
  confidence: number
  details: string[]
  preScreenshot?: string
  postScreenshot?: string
}

export interface CalibratedCoord {
  raw: { x: number; y: number }
  calibrated: { x: number; y: number }
  dpiScale: number
  monitorIndex: number
}

export const DEFAULT_MOVEMENT_PROFILE: MovementProfile = {
  style: 'bezier',
  speed: 'medium',
  overshootChance: 0.15,
  jitterAmount: 2,
  controlPointSpread: 0.3,
}

export const MOVEMENT_SPEED_MS: Record<MoveSpeed, { min: number; max: number }> = {
  slow: { min: 300, max: 600 },
  medium: { min: 120, max: 250 },
  fast: { min: 50, max: 100 },
  instant: { min: 0, max: 0 },
}
