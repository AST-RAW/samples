import {
  FitsImageStatistic,
  StellarSolver,
  ProcessType,
  SolverType,
  ExtractorType,
  ParametersProfile,
  ScaleUnits,
} from "@atoy40/stellarsolverjs";
import { Fits } from "@atoy40/ccfitsjs";
import { createCanvas, ImageData } from "canvas";
import fs from "fs";

const toPNG = async (output, buffer, axes, stars, solution) => {
  const fitsimage16 = new Uint16Array(buffer.buffer); // access buffer as 16 bit words
  const max = fitsimage16.reduce((c, p) => {
    return c > p ? c : p;
  }, 0);

  // draw fits buffer in canvas
  const canvas = createCanvas(axes[0], axes[1]);
  const ctx = canvas.getContext("2d");
  const imgdata = new ImageData(axes[0], axes[1]);

  for (let i = 0; i < axes[1]; i++) {
    for (let j = 0; j < axes[0]; j++) {
      // apply a tanh curve
      const value = Math.tanh((fitsimage16[i * axes[0] + j] / max) * 3) * 255;

      imgdata.data[4 * i * axes[0] + 4 * j] = value; // R
      imgdata.data[4 * i * axes[0] + 4 * j + 1] = value; // G
      imgdata.data[4 * i * axes[0] + 4 * j + 2] = value; // B
      imgdata.data[4 * i * axes[0] + 4 * j + 3] = 255; // A
    }
  }

  ctx.putImageData(imgdata, 0, 0);

  // mark stars
  ctx.lineWidth = axes[0] * 0.001;
  ctx.font = "bold 120px sans-serif";
  ctx.fillStyle = "#9bd1a8";
  ctx.strokeStyle = "#9bd1a8";
  for (const star of stars) {
    //ctx.fillText(star.hfr.toFixed(2), star.x+40, star.y);
    ctx.beginPath();
    ctx.arc(star.x * 3, star.y * 3, axes[0] * 0.005, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // display solution
  var ytext = 100;
  ctx.font = "100px sans-serif";
  ctx.fillText("Solution", 60, ytext);
  ctx.font = "bold 120px sans-serif";
  ctx.fillText("RA: " + solution.ra.toFixed(2) + "°", 60, ytext + 150);
  ctx.fillText("DEC: " + solution.dec.toFixed(2) + "°", 60, ytext + 300);
  ctx.fillText(
    "Rotation: " + solution.orientation.toFixed(2) + "°",
    60,
    ytext + 450
  );
  ctx.fillText(
    "FOV: " +
      solution.fieldWidth.toFixed(2) +
      "'x" +
      solution.fieldHeight.toFixed(2) +
      "'",
    60,
    ytext + 600
  );

  const data = await new Promise((resolve, reject) => {
    canvas.toBuffer((err, data) => {
      if (err) {
        return reject(err);
      }
      resolve(data);
    });
  });

  return fs.promises.writeFile(output, data);
};

const solve = async (file, output) => {
  // read fits
  const fits = new Fits(file);
  await fits.open();
  const hdu = await fits.pHDU();
  const axes = hdu.axes();
  const keyword = hdu.keyWord();
  const buffer = await hdu.read();

  // detect stars
  const stat = new FitsImageStatistic();
  stat.width = axes[0];
  stat.height = axes[1];
  stat.channels = 1;
  stat.samplesPerChannel = axes[0] * axes[1];

  const solver = new StellarSolver(stat, buffer);
  //solver.setSSLogLevel(2);
  solver.setIndexFolderPaths("/home/ahinsing/.local/share/kstars/astrometry");
  solver.setProperty("ExtractorType", ExtractorType.INTERNAL);
  solver.setProperty("SolverType", SolverType.STELLARSOLVER);
  solver.setProperty("ProcessType", ProcessType.SOLVE);
  solver.setProperty("LogToFile", true);
  solver.setProperty("LogFileName", "test.log");
  solver.setParameterProfile(ParametersProfile.SINGLE_THREAD_SOLVING);

  if (keyword.RA && keyword.DEC) {
    solver.setPosition(keyword.RA, keyword.DEC);
  }

  if (keyword.SCALE) {
    solver.setScale(
      keyword.SCALE * 0.8,
      keyword.SCALE * 1.2,
      ScaleUnits.ARCSEC_PER_PIX
    );
  }

  return new Promise(async (resolve, reject) => {
    solver
      .on("finished", async () => {
        solver.removeAllListeners();
        console.log("solver finished");

        if (!solver.solvingDone()) {
          solver.stop();
          console.log("Unable to solve image");
          reject();
          return;
        }

        console.log("generate PNG...");
        await toPNG(
          output,
          buffer,
          hdu.axes(),
          solver.getStarListFromSolve(),
          solver.getSolution()
        );
        console.log("PNG writed");
        solver.stop();
        resolve();
      })
      .on("log", (log) => {
        //console.log("LOG: " + log);
      });

    console.log("start solving " + file);
    solver.start();
  });
};

solve(process.argv[2], "test.png");
