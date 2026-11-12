import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tablero Brandmark",
  description: "Tablero de negocio Brandmark / NOA",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          EL TEMA SE APLICA ANTES DEL PRIMER PINTADO.

          Va como script suelto en el <head> --y no en un efecto de React-- por
          una sola razón: un efecto corre DESPUES de pintar, así que quien tenga
          el tema claro vería un fogonazo oscuro en cada carga de página. Son
          unos milisegundos, pero en un tablero que se abre cien veces por día
          es la diferencia entre "está prolijo" y "parpadea".

          Por eso también es síncrono y sin `defer`: tiene que bloquear.

          REPITE LA CLAVE Y EL ATRIBUTO que define lib/tema.ts, y no hay forma
          de que no lo haga: corre antes de que exista ningún módulo. Si alguna
          vez cambian allá, cambian acá -- son estas dos palabras.

          SOLO ACTUA PARA EL CLARO. El oscuro es el default del CSS, así que un
          navegador con JavaScript bloqueado, o que falle este script, muestra
          el tablero de siempre en vez de una pantalla a medio pintar.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('tablero-tema')==='claro'){" +
              "document.documentElement.dataset.tema='claro';" +
              "document.documentElement.style.colorScheme='light';}}catch(e){}",
          }}
        />
      </head>
      <body className="bg-bg text-ink flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
