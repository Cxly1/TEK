import { motion } from 'motion/react'
import { useTek } from '@/store'
import { fullGreeting } from '@/lib/greeting'
import { DecryptedText } from './DecryptedText'
import { FaultyBackdrop } from './FaultyBackdrop'
import { PlusButton } from './PlusButton'
import './genesis.css'

interface Props {
  onIgnite: () => void
}

/** Controles de ventana de Genesis: la ventana es frameless y esta pantalla no
 *  tiene TopBar, asi que sin esto no se puede minimizar/cerrar ni arrastrar.
 *  blur() tras el clic: el PlusButton escucha Enter/Espacio globales y un boton
 *  enfocado repetiria su accion con el mismo Enter que enciende TEK. */
function WindowControls(): React.JSX.Element {
  const blurAnd = (action: () => unknown) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    void action()
  }
  return (
    <div className="genesis-topbar drag">
      <div className="genesis-win no-drag">
        <button
          className="g-wbtn"
          title="Minimizar"
          tabIndex={-1}
          onClick={blurAnd(() => window.tek.win.minimize())}
        >
          ─
        </button>
        <button
          className="g-wbtn"
          title="Maximizar"
          tabIndex={-1}
          onClick={blurAnd(() => window.tek.win.maximizeToggle())}
        >
          ▢
        </button>
        <button
          className="g-wbtn g-wclose"
          title="Cerrar"
          tabIndex={-1}
          onClick={() => window.tek.win.close()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Pantalla de inicio: saludo por hora (con tu nombre) + el "+" que enciende TEK. */
export function Genesis({ onIgnite }: Props): React.JSX.Element {
  // El nombre ya esta cargado cuando Genesis se monta: App espera al perfil.
  const name = useTek((s) => s.profile?.name ?? '')
  return (
    <div className="genesis">
      <div className="genesis-bg">
        <FaultyBackdrop />
      </div>

      <WindowControls />

      <motion.div
        className="genesis-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="genesis-greet">
          <DecryptedText text={fullGreeting(name)} delay={200} speed={34} className="chroma" />
          <div className="genesis-sub">
            <DecryptedText text="¿Estás listo para trabajar?" delay={620} speed={26} />
          </div>
        </div>

        <PlusButton onIgnite={onIgnite} />

        <motion.span
          className="genesis-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8 }}
        >
          pulsa <kbd>Enter</kbd> o el <kbd>+</kbd>
        </motion.span>
      </motion.div>
    </div>
  )
}
