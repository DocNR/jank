import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { toProfile } from '@/lib/link'
import { generateImageByPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { SecondaryPageLink } from '@/DeckManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { cva, type VariantProps } from 'class-variance-authority'
import { useMemo } from 'react'
import Image from '../Image'

/**
 * W4 cva refactor + W5 density variant. The base table maps `size` to
 * Tailwind width/height pairs. The `density` axis (read from
 * UserPreferences) is combined with `size` via compoundVariants to shrink
 * every avatar by one size step when compact mode is on. Tiny stays tiny.
 */
const userAvatarVariants = cva('shrink-0 rounded-full', {
  variants: {
    size: {
      large: 'w-24 h-24',
      big: 'w-16 h-16',
      semiBig: 'w-12 h-12',
      normal: 'w-10 h-10',
      medium: 'w-9 h-9',
      small: 'w-7 h-7',
      xSmall: 'w-5 h-5',
      tiny: 'w-4 h-4'
    },
    density: {
      comfortable: '',
      compact: ''
    }
  },
  compoundVariants: [
    { size: 'large', density: 'compact', class: 'w-16 h-16' },
    { size: 'big', density: 'compact', class: 'w-12 h-12' },
    { size: 'semiBig', density: 'compact', class: 'w-10 h-10' },
    { size: 'normal', density: 'compact', class: 'w-9 h-9' },
    { size: 'medium', density: 'compact', class: 'w-7 h-7' },
    { size: 'small', density: 'compact', class: 'w-5 h-5' },
    { size: 'xSmall', density: 'compact', class: 'w-4 h-4' }
    // 'tiny' under compact stays at w-4 h-4 (already minimal)
  ],
  defaultVariants: {
    size: 'normal',
    density: 'comfortable'
  }
})

export type UserAvatarSize = NonNullable<VariantProps<typeof userAvatarVariants>['size']>

export default function UserAvatar({
  userId,
  className,
  size = 'normal'
}: {
  userId: string
  className?: string
  size?: UserAvatarSize
}) {
  const { autoLoadProfilePicture } = useContentPolicy()

  if (!autoLoadProfilePicture) {
    return null
  }

  return (
    <SecondaryPageLink to={toProfile(userId)} onClick={(e) => e.stopPropagation()}>
      <SimpleUserAvatar userId={userId} size={size} className={className} />
    </SecondaryPageLink>
  )
}

export function SimpleUserAvatar({
  userId,
  size = 'normal',
  className,
  onClick,
  ignorePolicy
}: {
  userId: string
  size?: UserAvatarSize
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  ignorePolicy?: boolean
}) {
  const { profile } = useFetchProfile(userId)
  const { autoLoadProfilePicture } = useContentPolicy()
  const { density } = useUserPreferences()
  const defaultAvatar = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile.pubkey) : ''),
    [profile]
  )

  if (!ignorePolicy && !autoLoadProfilePicture) {
    return null
  }

  if (!profile) {
    return <Skeleton className={cn(userAvatarVariants({ size, density }), className)} />
  }
  const { avatar, pubkey } = profile || {}

  const imageUrl = avatar ?? defaultAvatar

  return (
    <Image
      image={{ url: imageUrl, pubkey }}
      errorPlaceholder={defaultAvatar}
      className="object-cover object-center"
      classNames={{
        wrapper: cn(userAvatarVariants({ size, density }), 'bg-background', className)
      }}
      onClick={onClick}
    />
  )
}

export function UserAvatarSkeleton({ className }: { className?: string }) {
  const { autoLoadProfilePicture } = useContentPolicy()
  if (!autoLoadProfilePicture) return null
  return <Skeleton className={cn('shrink-0 rounded-full', className)} />
}
