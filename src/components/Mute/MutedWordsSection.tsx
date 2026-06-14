import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { Ban, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Muted-words manager: an add input plus the current list. `variant` controls
 * the list rendering only — `chips` (compact wrap, used in Settings) or `rows`
 * (full-width rows, used in the Muted column so all three mute types read as
 * the same kind of list).
 */
export default function MutedWordsSection({
  variant = 'chips'
}: {
  variant?: 'chips' | 'rows'
}) {
  const { t } = useTranslation()
  const { mutedWords, setMutedWords } = useContentPolicy()
  const [newMutedWord, setNewMutedWord] = useState('')

  const handleAddMutedWord = () => {
    const word = newMutedWord.trim().toLowerCase()
    if (word && !mutedWords.includes(word)) {
      setMutedWords([...mutedWords, word])
      setNewMutedWord('')
    }
  }

  const handleRemoveMutedWord = (word: string) => {
    setMutedWords(mutedWords.filter((w) => w !== word))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddMutedWord()
    }
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder={t('Add muted word')}
          value={newMutedWord}
          onChange={(e) => setNewMutedWord(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleAddMutedWord}
          disabled={!newMutedWord.trim() || mutedWords.includes(newMutedWord.trim())}
        >
          <Plus />
        </Button>
      </div>
      {mutedWords.length > 0 &&
        (variant === 'rows' ? (
          <div className="space-y-1">
            {mutedWords.map((word) => (
              <div key={word} className="flex items-center gap-2 py-1.5">
                <Ban className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="w-full truncate text-sm">{word}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleRemoveMutedWord(word)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mutedWords.map((word) => (
              <div
                key={word}
                className="bg-muted flex items-center gap-1 rounded-md px-2 py-1 text-sm"
              >
                <span>{word}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 hover:bg-transparent"
                  onClick={() => handleRemoveMutedWord(word)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
