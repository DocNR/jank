import { Button, ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const SidebarItem = forwardRef<
  HTMLButtonElement,
  ButtonProps & { title: string; collapse: boolean; description?: string; active?: boolean }
>(({ children, title, description, className, active, collapse, ...props }, ref) => {
  const { t } = useTranslation()
  const { density } = useUserPreferences()
  const isCompact = density === 'compact'

  return (
    <Button
      className={cn(
        'm-0 flex items-center rounded-lg bg-transparent font-semibold shadow-none transition-colors duration-500',
        isCompact ? 'gap-3 text-base' : 'gap-4 text-lg',
        collapse
          ? isCompact
            ? 'h-10 w-10 p-2 [&_svg]:size-5'
            : 'h-12 w-12 p-3 [&_svg]:size-6'
          : isCompact
            ? 'h-auto w-full justify-start px-2 py-1 [&_svg]:size-4'
            : 'h-auto w-full justify-start px-3 py-2 [&_svg]:size-5',
        active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
        className
      )}
      variant="ghost"
      title={t(title)}
      ref={ref}
      {...props}
    >
      {children}
      {!collapse && <div>{t(description ?? title)}</div>}
    </Button>
  )
})
SidebarItem.displayName = 'SidebarItem'
export default SidebarItem
