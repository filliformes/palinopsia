# Bibliography

This is the reading list behind Palinopsia: the scientific papers, books, theses, technical articles, standards and open-source projects that its generators, effects, analysis buses, sound engine and control systems are built on or were designed from. Each entry is followed by one line (marked ↳) naming the part of the instrument that uses it; where the code follows a source closely, the source is also credited in a comment beside that code. References follow APA 7th edition, grouped by topic and alphabetical within each group. Titles in languages other than English carry a bracketed English translation. Artworks and commercial products that inspired features are deliberately left out.

## Contents

1. [Noise, hashing and procedural texture](#1-noise-hashing-and-procedural-texture)
2. [Texture synthesis and neural cellular automata](#2-texture-synthesis-and-neural-cellular-automata)
3. [Fluids, flow and advection](#3-fluids-flow-and-advection)
4. [Reaction-diffusion and pattern formation](#4-reaction-diffusion-and-pattern-formation)
5. [Natural materials and growth](#5-natural-materials-and-growth)
6. [Film, video and display artifacts](#6-film-video-and-display-artifacts)
7. [Glitch, compression and datamosh](#7-glitch-compression-and-datamosh)
8. [Perception and optics](#8-perception-and-optics)
9. [Image processing and computer vision](#9-image-processing-and-computer-vision)
10. [Corpus-based video and automatic editing](#10-corpus-based-video-and-automatic-editing)
11. [Audio analysis and sonification](#11-audio-analysis-and-sonification)
12. [Modulation, mapping and performance control](#12-modulation-mapping-and-performance-control)
13. [Audiovisual composition theory](#13-audiovisual-composition-theory)
14. [Video feedback](#14-video-feedback)
15. [Projection and fulldome](#15-projection-and-fulldome)
16. [Standards, protocols and open-source software](#16-standards-protocols-and-open-source-software)
17. [To verify](#17-to-verify)

---

## 1. Noise, hashing and procedural texture

Ebert, D. S., Musgrave, F. K., Peachey, D., Perlin, K., & Worley, S. (2003). *Texturing and modeling: A procedural approach* (3rd ed.). Morgan Kaufmann.

↳ Fractal (fbm) and ridged noise across the Organic family: Erosion's carved channels, Mycelium's hyphae, the grain of Colony and Ground.

Hoskins, D. (2014). *Hash without sine* [Computer software, MIT License]. Shadertoy. https://www.shadertoy.com/view/4djSRW

↳ The sine-free hashes of the Organic toolkit (`og_hash` in `shaders/isf/lib/organic.glsl`) and the precise hash in Byte Corrupt, Compress, Databend, Mosh Blocks, Pixelmask, Row Echo, Slice Shuffle and Stutter.

Montfort, N., Baudoin, P., Bell, J., Bogost, I., Douglass, J., Marino, M. C., Mateas, M., Reas, C., Sample, M., & Vawter, N. (2012). *10 PRINT CHR$(205.5+RND(1)); : GOTO 10*. MIT Press. https://doi.org/10.7551/mitpress/9040.001.0001

↳ The Ten Print generator (the one-line maze and its arc variant).

Perlin, K. (1985). An image synthesizer. *ACM SIGGRAPH Computer Graphics, 19*(3), 287–296. https://doi.org/10.1145/325165.325247

↳ Gradient and value noise under most generators, and the noise-driven placement of film dust in the Finalizer film damage (`engine/filmDamage.ts`).

Quilez, I. (n.d.). *2D distance functions*. https://iquilezles.org/articles/distfunctions2d/

↳ The quadratic Bézier distance that draws the fibres and the gate hair in the Finalizer film damage.

Quilez, I. (2012). *Voronoi edges*. https://iquilezles.org/articles/voronoilines/

↳ `og_voronoi`, the exact cell-border distance behind Ground's cracked mud (cracks that keep one width and meet cleanly).

Quilez, I. (2017). *Gradient noise derivatives*. https://iquilezles.org/articles/gradientnoise/

↳ `og_noised`, the gradient noise with analytic derivatives under the Organic toolkit's fbm (Colony, Ground, Swell).

Worley, S. (1996). A cellular texture basis function. In *Proceedings of the 23rd Annual Conference on Computer Graphics and Interactive Techniques (SIGGRAPH '96)* (pp. 291–294). ACM. https://doi.org/10.1145/237170.237267

↳ The Worley F1/F2 cells of the Organic toolkit: pores, grains, plates and areolae.

## 2. Texture synthesis and neural cellular automata

Heitz, E., Vanhoey, K., Chambon, T., & Belcour, L. (2021). A sliced Wasserstein loss for neural texture synthesis. In *2021 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)* (pp. 9407–9415). IEEE. https://doi.org/10.1109/CVPR46437.2021.00929

↳ The sliced optimal-transport loss of the NCA trainer (`tools/nca/train_texture_nca.py`).

Mikkelsen, M. S. (2022). Practical real-time hex-tiling. *Journal of Computer Graphics Techniques, 11*(3), 77–94. http://jcgt.org/published/0011/03/05/

↳ The Scan generator's hex tiling, which lays 30 CC0 surface scans across the frame without visible repetition.

Mordvintsev, A., Randazzo, E., Niklasson, E., & Levin, M. (2020). Growing neural cellular automata. *Distill, 5*(2). https://doi.org/10.23915/distill.00023

↳ The damage-and-regrow training that lets the Grown source heal when DAMAGE tears a hole in it.

Niklasson, E., Mordvintsev, A., Randazzo, E., & Levin, M. (2021). Self-organising textures. *Distill, 6*(2). https://doi.org/10.23915/distill.00027.003

↳ The Grown source (`engine/NcaSource.ts`) and its trainer: a 12-channel texture NCA with identity, Sobel and Laplacian perception.

Simonyan, K., & Zisserman, A. (2015). Very deep convolutional networks for large-scale image recognition. In *3rd International Conference on Learning Representations (ICLR 2015)*. https://doi.org/10.48550/arXiv.1409.1556

↳ The VGG16 feature space in which the NCA trainer compares a grown texture with its target photo.

## 3. Fluids, flow and advection

Bridson, R., Hourihan, J., & Nordenstam, M. (2007). Curl-noise for procedural fluid flow. *ACM Transactions on Graphics, 26*(3), Article 46. https://doi.org/10.1145/1276377.1276435

↳ The divergence-free velocity field that advects the Organic generator (fire, water, nature) and the curl-noise base field of the Sillage node.

Tessendorf, J. (2001). *Simulating ocean water* [Course notes]. ACM SIGGRAPH. https://jtessen.people.clemson.edu/reports/papers_files/coursenotes2002.pdf

↳ The deep-water dispersion law (ω = √(gk)) that sets the speed of every wave train in Swell and in the Organic water.

van Wijk, J. J. (2002). Image based flow visualization. *ACM Transactions on Graphics, 21*(3), 745–754. https://doi.org/10.1145/566654.566646

↳ The Sillage node (`node-ibfv`): a dye buffer advected along a flow field and refreshed with filtered noise.

## 4. Reaction-diffusion and pattern formation

Gray, P., & Scott, S. K. (1984). Autocatalytic reactions in the isothermal, continuous stirred tank reactor: Oscillations and instabilities in the system A + 2B → 3B; B → C. *Chemical Engineering Science, 39*(6), 1087–1097. https://doi.org/10.1016/0009-2509(84)87017-7

↳ The Gray-Scott model simulated by the Reaction generator.

Pearson, J. E. (1993). Complex patterns in a simple system. *Science, 261*(5118), 189–192. https://doi.org/10.1126/science.261.5118.189

↳ The feed/kill map behind Reaction's presets (spots, stripes, labyrinths, mitosis).

Turing, A. M. (1952). The chemical basis of morphogenesis. *Philosophical Transactions of the Royal Society of London. Series B, Biological Sciences, 237*(641), 37–72. https://doi.org/10.1098/rstb.1952.0012

↳ The theory of the Turing patterns that Reaction and the Organic / Reaction-Diffusion themes grow.

## 5. Natural materials and growth

Cetegen, B. M., & Ahmed, T. A. (1993). Experiments on the periodic instability of buoyant plumes and pool fires. *Combustion and Flame, 93*(1–2), 157–184. https://doi.org/10.1016/0010-2180(93)90090-P

↳ The puffing of the Organic fire: flame height pulses at a few hertz, slower for bigger flames.

Goehring, L., Conroy, R., Akhter, A., Clegg, W. J., & Routh, A. F. (2010). Evolution of mud-crack patterns during repeated drying cycles. *Soft Matter, 6*(15), 3562–3567. https://doi.org/10.1039/b922206e

↳ The crack hierarchy of Ground's cracked mud (plates that split in a second generation as the mud dries).

Helland, T. (2012, September 18). *How to convert temperature (K) to RGB: Algorithm and sample code*. tannerhelland.com. https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html

↳ `og_blackbody`, the blackbody colour of the Organic fire.

Kardar, M., Parisi, G., & Zhang, Y.-C. (1986). Dynamic scaling of growing interfaces. *Physical Review Letters, 56*(9), 889–892. https://doi.org/10.1103/PhysRevLett.56.889

↳ The roughness of Colony's growth fronts (lichen, mould, rust, burning paper).

Maunuksela, J., Myllys, M., Kähkönen, O.-P., Timonen, J., Provatas, N., Alava, M. J., & Ala-Nissila, T. (1997). Kinetic roughening in slow combustion of paper. *Physical Review Letters, 79*(8), 1515–1518. https://doi.org/10.1103/PhysRevLett.79.1515

↳ The measured front statistics that make Colony's burning paper advance like the real thing.

## 6. Film, video and display artifacts

Corbeil-Perron, M. (2021). *Créations audiovisuelles archéomédiatiques* [Media-archaeological audiovisual creations] [Doctoral thesis, Université de Montréal]. Papyrus. http://hdl.handle.net/1866/26965

↳ The Finalizer's anaglyph 3D stage, Optical Rain, Phosphene, the Op-Art generator and the Tonicity, Shutter and Drift temperament controls (`engine/temperament.ts`).

Della Noce, E., & Murari, L. (Eds.). (2025). *Expanded nature: Écologies du cinéma expérimental* [Expanded nature: Ecologies of experimental cinema]. Palgrave Macmillan. https://doi.org/10.1007/978-3-031-70729-2

↳ One of three texts behind the persistence and entropy shelf: Eternalism, Afterimage, Pulfrich, Corrode, Decimate, Frame-Weave, the Burial and Long-Take arcs, the Flow / Interruption temperament.

Ivanova, D., Williamson, J., & Henderson, P. (2023). Simulating analogue film damage to analyse and improve artefact restoration on high-resolution scans. *Computer Graphics Forum, 42*(2), 133–148. https://doi.org/10.1111/cgf.14749

↳ The Finalizer film damage (`engine/filmDamage.ts`): dust, dirt, hair and scratch statistics from hand-labelled 4K scans.

Joyeux, L., Buisson, O., Besserer, B., & Boukir, S. (1999). Detection and removal of line scratches in motion picture films. In *Proceedings of the 1999 IEEE Computer Society Conference on Computer Vision and Pattern Recognition* (Vol. 1, pp. 548–553). IEEE. https://doi.org/10.1109/CVPR.1999.786991

↳ The slow sinusoidal wander of the Finalizer's roller scratches.

Smith, V., & Hamlyn, N. (Eds.). (2018). *Experimental and expanded animation: New perspectives and practices*. Palgrave Macmillan. https://doi.org/10.1007/978-3-319-73873-4

↳ One of three texts behind the persistence and entropy shelf (Eternalism, Afterimage, Pulfrich, Frame-Weave, Decimate and their siblings).

Thouvenel, É. (Ed.). (2023). *Bricolage et ingénierie dans le cinéma expérimental / Bricolage and engineering in experimental cinema*. CinéMédias. https://doi.org/10.62212/1866/32873

↳ The Eternalism node (held frames across a black shutter, phase-drifting twins), the Frame-Weave sequencer and the rest of the persistence and entropy shelf.

## 7. Glitch, compression and datamosh

Betancourt, M. (2022). Glitch art and the cinematic articulation of the 'shot': The convergence of datamoshing with the long take. *Journal of Visual Art Practice, 21*(1), 47–71. https://doi.org/10.1080/14702029.2021.2020592

↳ The Datamosh node's premise: movement separated from the image it moves (bloom and smear).

Brown, W., & Kutty, M. (2012). Datamoshing and the emergence of digital complexity from digital chaos. *Convergence: The International Journal of Research into New Media Technologies, 18*(2), 165–176. https://doi.org/10.1177/1354856511433683

↳ The Datamosh node and the compression-decay chains of the master presets.

Cascone, K. (2000). The aesthetics of failure: "Post-digital" tendencies in contemporary computer music. *Computer Music Journal, 24*(4), 12–18. https://doi.org/10.1162/014892600559489

↳ The Decay FX (generation loss) and the glitch vocabulary as the medium's own voice.

Chalier, Y. (2024). *transflow: Optical flow transfer* [Computer software, GPL-3.0]. GitHub. https://github.com/ychalier/transflow

↳ The Datamosh node's sticky and melt modes and its stochastic reseed.

Denson, S. (2020). *Discorrelated images*. Duke University Press. https://doi.org/10.1215/9781478012412

↳ Background reading for the Datamosh node and the datamosh research family.

Kane, C. L. (2019). *High-tech trash: Glitch, noise, and aesthetic failure*. University of California Press. https://doi.org/10.1525/luminos.83

↳ The glitch-as-controlled-texture stance of Datamosh, Compress, Databend and Pixel Sort.

Menkman, R. (2011). *The glitch moment(um)* (Network Notebooks 04). Institute of Network Cultures. https://networkcultures.org/blog/publication/no-04-the-glitch-momentum-rosa-menkman/

↳ The datamosh research family (Datamosh node, Compress, Databend, Pixel Sort): glitch as the medium's own voice.

Morgan, C. (2019). Calculated error: Glitch art, compression artefacts, and digital materiality. *A Peer-Reviewed Journal About, 8*(1), 204–217. https://doi.org/10.7146/aprja.v8i1.115426

↳ The macroblock model: Datamosh's block-quantised motion vectors and the Compress FX.

Rivaux, A. (2019). *datamoshing-GLSL* [Computer software, GPL-3.0]. GitHub. https://github.com/alexr4/datamoshing-GLSL

↳ The GPU optical-flow approach the Datamosh node's flow pass starts from.

## 8. Perception and optics

Cutting, J. E., & Vishton, P. M. (1995). Perceiving layout and knowing distances: The integration, relative potency, and contextual use of different information about depth. In W. Epstein & S. Rogers (Eds.), *Perception of space and motion* (pp. 69–117). Academic Press. https://doi.org/10.1016/B978-012240530-3/50005-5

↳ The Proximity macro (vista, action and personal space as haze, blur, vignette and scale).

Goethe, J. W. von. (1840). *Theory of colours* (C. L. Eastlake, Trans.). John Murray. (Original work published 1810)

↳ The Afterimage node (a departed bright form leaves a dark or complementary ghost) and the Phosphene FX.

McGurk, H., & MacDonald, J. (1976). Hearing lips and seeing voices. *Nature, 264*(5588), 746–748. https://doi.org/10.1038/264746a0

↳ The audio bus design rule: drive discontinuities (flux, transients) rather than gain.

Pulfrich, C. (1922). Die Stereoskopie im Dienste der isochromen und heterochromen Photometrie [Stereoscopy in the service of isochromatic and heterochromatic photometry]. *Die Naturwissenschaften, 10*(25), 553–564. https://doi.org/10.1007/BF01571319

↳ The Pulfrich node: monocular 3D from a per-pixel temporal eye delay.

Shimojo, S., & Shams, L. (2001). Sensory modalities are not separate modalities: Plasticity and interactions. *Current Opinion in Neurobiology, 11*(4), 505–509. https://doi.org/10.1016/S0959-4388(00)00241-5

↳ The same audio bus rule (`engine/audioIn.ts`): the more discontinuous signal dominates cross-modal perception.

## 9. Image processing and computer vision

Bayer, B. E. (1973). An optimum method for two-level rendition of continuous-tone pictures. In *IEEE International Conference on Communications, Conference Record* (Vol. 1, pp. 26-11–26-15). IEEE.

↳ The 4×4 ordered-dither matrix of the Ordered Dither FX.

Bobick, A. F., & Davis, J. W. (2001). The recognition of human movement using temporal templates. *IEEE Transactions on Pattern Analysis and Machine Intelligence, 23*(3), 257–267. https://doi.org/10.1109/34.910878

↳ The Sediment node, a motion-history image where brightness stands for recency.

Darabi, S., Shechtman, E., Barnes, C., Goldman, D. B., & Sen, P. (2012). Image melding: Combining inconsistent images using patch-based synthesis. *ACM Transactions on Graphics, 31*(4). https://doi.org/10.1145/2185520.2185578

↳ The Mosaïque node's patch matching (orientation search, gradient term, re-tint and seam melt).

Forbes, A. G., & Villegas, J. (2015). Video granular synthesis. In P. Rosin (Ed.), *Computational Aesthetics in Graphics, Visualization, and Imaging (Expressive 2015)* (pp. 195–201). The Eurographics Association. https://doi.org/10.2312/exp.20151192

↳ The Granular FX (Hann-windowed video grains, scattered, rotated and resynthesized).

Horn, B. K. P., & Schunck, B. G. (1981). Determining optical flow. *Artificial Intelligence, 17*(1–3), 185–203. https://doi.org/10.1016/0004-3702(81)90024-2

↳ The brightness-constancy flow estimate shared by Transfert, Datamosh and Sillage.

Immerkær, J. (1996). Fast noise variance estimation. *Computer Vision and Image Understanding, 64*(2), 300–302. https://doi.org/10.1006/cviu.1996.0060

↳ Assemble's grain descriptor (clean to noisy), in `shared/assemble.ts`.

Kang, H., Lee, S., & Chui, C. K. (2007). Coherent line drawing. In *Proceedings of the 5th International Symposium on Non-Photorealistic Animation and Rendering (NPAR '07)* (pp. 43–50). ACM. https://doi.org/10.1145/1274871.1274878

↳ The edge-tangent-flow line work of the Toile node.

Kyprianidis, J. E., Kang, H., & Döllner, J. (2009). Image and video abstraction by anisotropic Kuwahara filtering. *Computer Graphics Forum, 28*(7), 1955–1963. https://doi.org/10.1111/j.1467-8659.2009.01574.x

↳ The Toile node's structure-tensor, eight-sector painterly flattening.

Levin, G. (2005). *An informal catalogue of slit-scan video artworks and research* (Last edited 2015, February 26). flong.com. https://www.flong.com/archive/texts/lists/slit_scan/index.html

↳ The slit-scan family: Chronoscan node, Slit Buffer FX and Slit Scan generator.

Lucas, B. D., & Kanade, T. (1981). An iterative image registration technique with an application to stereo vision. In *Proceedings of the 7th International Joint Conference on Artificial Intelligence (IJCAI '81)* (Vol. 2, pp. 674–679). https://publications.ri.cmu.edu/an-iterative-image-registration-technique-with-an-application-to-stereo-vision-ijcai

↳ The gradient optical flow of the Transfert node (`engine/convNodes.ts`), reused by Datamosh and Sillage.

Lugaresi, C., Tang, J., Nash, H., McClanahan, C., Uboweja, E., Hays, M., Zhang, F., Chang, C.-L., Yong, M. G., Lee, J., Chang, W.-T., Hua, W., Georg, M., & Grundmann, M. (2019). *MediaPipe: A framework for building perception pipelines* (arXiv:1906.08172). arXiv. https://doi.org/10.48550/arXiv.1906.08172

↳ The body tracker (`engine/bodyTracker.ts`): hands, pose, face blendshapes and the silhouette mask.

Niklaus, S., Mai, L., & Liu, F. (2017). Video frame interpolation via adaptive separable convolution. In *2017 IEEE International Conference on Computer Vision (ICCV)* (pp. 261–270). IEEE. https://doi.org/10.1109/ICCV.2017.37

↳ Transfert's Traînée mode, a per-pixel flow-steered line blur (the kernel encodes the motion).

patrickhartono. (2025). *CIS: Concatenated image synthesis* [Computer software, MIT License]. GitHub. https://github.com/patrickhartono/CIS

↳ Prior art for the Mosaïque node (spatial concatenative synthesis from a live corpus).

Seitz, S. M., & Baker, S. (2009). Filter flow. In *2009 IEEE 12th International Conference on Computer Vision* (pp. 143–150). IEEE. https://doi.org/10.1109/ICCV.2009.5459155

↳ The theoretical frame of the convolution nodes: Convolution as the kernel K, Transfert as the motion M, Réponse as the kernel extended in time.

Shannon, C. E. (1948). A mathematical theory of communication. *Bell System Technical Journal, 27*(3), 379–423. https://doi.org/10.1002/j.1538-7305.1948.tb01338.x

↳ The entropy feature of the vision bus (`engine/visionIn.ts`).

Sobel, I., & Feldman, G. (1968). *A 3×3 isotropic gradient operator for image processing* [Unpublished presentation]. Stanford Artificial Intelligence Project.

↳ The Edge FX, the Toile structure tensor, the Sonify Events voice, the NCA perception filters and Assemble's edge descriptor.

Villegas, J., & Forbes, A. G. (2014). Analysis/synthesis approaches for creatively processing video signals. In *Proceedings of the 22nd ACM International Conference on Multimedia* (pp. 37–46). ACM. https://doi.org/10.1145/2647868.2654944

↳ The Tiles FX (an analysis/resynthesis grid whose tile size follows the cell's luminance).

Winnemöller, H., Kyprianidis, J. E., & Olsen, S. C. (2012). XDoG: An eXtended difference-of-Gaussians compendium including advanced image stylization. *Computers & Graphics, 36*(6), 740–753. https://doi.org/10.1016/j.cag.2012.03.004

↳ The flow-XDoG line work of the Toile node.

Yang, L., Kang, B., Huang, Z., Zhao, Z., Xu, X., Feng, J., & Zhao, H. (2024). Depth Anything V2. In *Advances in Neural Information Processing Systems 37* (pp. 21875–21911). https://doi.org/10.52202/079017-0688

↳ The AI depth mode (`engine/depthEstimate.ts`) that feeds Context haze, the anaglyph convergence, the depth shadow and the Pulfrich node.

## 10. Corpus-based video and automatic editing

Dimopoulos, M., & Winkler, T. (2014). Image warmness: A new perceptual feature for images and videos. In *2014 22nd European Signal Processing Conference (EUSIPCO)* (pp. 1662–1666). IEEE. https://doi.org/10.5281/zenodo.43869

↳ Assemble's warmth axis (hue split into warm and cold, weighted by saturation and value).

Fayet, M., Schwarz, D., & Tiffon, V. (2024). VIVO: Video analysis for corpus-based audio–visual synthesis. In *Actes des Journées d'Informatique Musicale (JIM 2024)* [Proceedings of the Computer Music Days] (pp. 257–264). https://hal.science/hal-04576894

↳ Assemble's descriptor set (`shared/assemble.ts` follows VIVO's table 1).

Schödl, A., & Essa, I. A. (2002). Controlled animation of video sprites. In *Proceedings of the 2002 ACM SIGGRAPH/Eurographics Symposium on Computer Animation* (pp. 121–127). ACM. https://doi.org/10.1145/545261.545281

↳ Assemble's follow-the-live-output mode (`assemble/liveMatch.ts`), which steers clip selection toward a target.

Schödl, A., Szeliski, R., Salesin, D. H., & Essa, I. (2000). Video textures. In *Proceedings of the 27th Annual Conference on Computer Graphics and Interactive Techniques (SIGGRAPH '00)* (pp. 489–498). ACM. https://doi.org/10.1145/344779.345012

↳ Assemble's transition math (`assemble/match.ts`): the Boltzmann draw over cost and the tail-to-head successor join.

Schwarz, D. (2006). Concatenative sound synthesis: The early years. *Journal of New Music Research, 35*(1), 3–22. https://doi.org/10.1080/09298210600696857

↳ Assemble's greedy nearest-neighbour selection in place of a Viterbi path.

Schwarz, D., Beller, G., Verbrugghe, B., & Britton, S. (2006). Real-time corpus-based concatenative synthesis with CataRT. In *Proceedings of the 9th International Conference on Digital Audio Effects (DAFx-06)* (pp. 279–282). https://www.dafx.de/paper-archive/2006/papers/p_279.pdf

↳ Assemble as a whole (CataRT ported to video) and its spatial sibling, the Mosaïque node.

## 11. Audio analysis and sonification

Bello, J. P., Daudet, L., Abdallah, S., Duxbury, C., Davies, M., & Sandler, M. B. (2005). A tutorial on onset detection in music signals. *IEEE Transactions on Speech and Audio Processing, 13*(5), 1035–1047. https://doi.org/10.1109/TSA.2005.851998

↳ The flux and transient features of the audio bus (`engine/audioIn.ts`).

Bristow-Johnson, R. (2021). *Audio EQ cookbook* (R. Toy, Ed.) [W3C Working Group Note]. W3C. https://www.w3.org/TR/2021/NOTE-audio-eq-cookbook-20210608/

↳ The biquads of the per-voice DJ filter in the Sonify mixer (`audio/soni.worklet.js`).

Chamberlin, H. (1985). *Musical applications of microprocessors* (2nd ed.). Hayden Book Company.

↳ The state-variable filters of the Sonify worklet (the Raster tone control and the Filter voice's band-pass bank).

Gruy, E., & Berthaut, F. (2026). Extended reality audio-visual instruments: Design framework and case study. In B. Gaster, J. Tragtenberg, A. Xambó, & T. Mitchell (Eds.), *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 788–797). https://doi.org/10.5281/zenodo.20784281

↳ The colour-to-sound correspondences behind the audio noisiness and vision hue and saturation features.

Hermann, T., Hunt, A., & Neuhoff, J. G. (Eds.). (2011). *The sonification handbook*. Logos Publishing House. https://sonification.de/handbook/

↳ The vocabulary for Sonify's voices (audification in Raster and Transmission, parameter mapping in Spectra, Chord, Events and Filter).

Jot, J.-M., & Chaigne, A. (1991). *Digital delay networks for designing artificial reverberators* [Paper presentation, Convention paper 3030]. 90th Convention of the Audio Engineering Society, Paris, France. https://aes2.org/publications/elibrary-page/?id=5663

↳ The feedback delay network reverb of Sonify's FX tail.

Meijer, P. B. L. (1992). An experimental system for auditory image representations. *IEEE Transactions on Biomedical Engineering, 39*(2), 112–121. https://doi.org/10.1109/10.121642

↳ The Spectra voice: a line sweeping the image, row height to pitch, brightness to loudness.

Mitsuhashi, Y. (1982). Audio signal synthesis by functions of two variables. *Journal of the Audio Engineering Society, 30*(10), 701–706.

↳ The Orbit voice (wave-terrain reading of the frame along a circle or Lissajous path).

O'Flaherty, T. F., Marino, L., Saitis, C., & Xambó Sedó, A. (2025). Sonicolour: Exploring colour control of sound synthesis with interactive machine learning. In D. Cavdir & F. Berthaut (Eds.), *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 462–467). https://doi.org/10.5281/zenodo.15698928

↳ The colour features that drive Sonify parameters and the "from picture" Climate suggestion (`climateFromColour` in `worlds.ts`).

Peeters, G., Giordano, B. L., Susini, P., Misdariis, N., & McAdams, S. (2011). The Timbre Toolbox: Extracting audio descriptors from musical signals. *The Journal of the Acoustical Society of America, 130*(5), 2902–2916. https://doi.org/10.1121/1.3642604

↳ The spectral centroid and spectral flatness (noisiness) features of the audio bus.

Pelletier, J.-M. (2008). Sonified motion flow fields as a means of musical expression. In *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 158–163). https://doi.org/10.5281/zenodo.1179611

↳ The Flow voice (motion blocks to grains) and its onset dithering across the frame interval.

Rabiner, L. (1977). On the use of autocorrelation analysis for pitch detection. *IEEE Transactions on Acoustics, Speech, and Signal Processing, 25*(1), 24–33. https://doi.org/10.1109/TASSP.1977.1162905

↳ The autocorrelation pitch feature of the audio bus.

Roads, C. (2001). *Microsound*. MIT Press. https://doi.org/10.7551/mitpress/4601.001.0001

↳ The grain model of the Flow voice and of the Granular FX.

Verplank, B., Mathews, M., & Shaw, R. (2000). Scanned synthesis. In *Proceedings of the 2000 International Computer Music Conference* (pp. 368–371). International Computer Music Association.

↳ The surface-readout family of Sonify voices, to which Orbit belongs (a slowly moving image read as a waveform).

Yeo, W. S., & Berger, J. (2006). Raster scanning: A new approach to image sonification, sound visualization, sound analysis and synthesis. In *Proceedings of the 2006 International Computer Music Conference*. International Computer Music Association. https://quod.lib.umich.edu/i/icmc/bbp2372.2006.008

↳ The Raster voice (row-by-row audification of a probe rectangle).

## 12. Modulation, mapping and performance control

Ashby, W. R. (1952). *Design for a brain*. Chapman & Hall.

↳ The Homeostat modulator, which holds a vision feature near a self-adapting baseline.

Bencina, R. (2005). The Metasurface: Applying natural neighbour interpolation to two-to-many mapping. In *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 101–104). https://doi.org/10.5281/zenodo.1176701

↳ The Metasurface (`surface.ts`, `SurfacePad.tsx`, OSC `/opsia/surface`): scenes as points on a plane, blended by a cursor.

Bjorklund, E. (2003). *The theory of rep-rate pattern generation in the SNS timing system* (SNS ASD Technical Note SNS-NOTE-CNTRL-99). Los Alamos National Laboratory.

↳ The even pulse distribution of the Euclid modulator (`engine/modulation.ts`).

Castro, D. (2025). The Shadow Harvester: Sonifying the body through light. In D. Cavdir & F. Berthaut (Eds.), *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 312–318). https://doi.org/10.5281/zenodo.15698869

↳ The silhouette zone features and cover gestures of the Body page.

May, R. M. (1976). Simple mathematical models with very complicated dynamics. *Nature, 261*(5560), 459–467. https://doi.org/10.1038/261459a0

↳ The logistic-map Chaos modulator.

Momeni, A., & Henry, C. (2006). Dynamic independent mapping layers for concurrent control of audio and video synthesis. *Computer Music Journal, 30*(1), 49–66. https://doi.org/10.1162/comj.2006.30.1.49

↳ Opsia's role as the intermediate mapping layer between gesture, image and Pandore's sound (OSC in and out).

Toussaint, G. T. (2005). The Euclidean algorithm generates traditional musical rhythms. In *Proceedings of BRIDGES: Mathematical Connections in Art, Music and Science* (pp. 47–56). https://archive.bridgesmathart.org/2005/bridges2005-47.html

↳ The Euclid modulator.

Trolland, S., Ilsar, A., & McCormack, J. (2025). Visually-led design for gestural audiovisual instruments. In D. Cavdir & F. Berthaut (Eds.), *Proceedings of the International Conference on New Interfaces for Musical Expression* (pp. 328–336). https://doi.org/10.5281/zenodo.15699633

↳ The case for the vision return path: the picture leads, its features stream out over OSC.

Wolfram, S. (1983). Statistical mechanics of cellular automata. *Reviews of Modern Physics, 55*(3), 601–644. https://doi.org/10.1103/RevModPhys.55.601

↳ The Cellular modulator (one-dimensional elementary automata under rules 30, 90, 110 and 150).

## 13. Audiovisual composition theory

Basanta, A. (2013). *Compositional strategies in light and sound installations* [Master's thesis, Concordia University]. Spectrum Research Repository. https://spectrum.library.concordia.ca/id/eprint/976949/

↳ The coupling engine (Bond), the Density macro, the Motif FX, the A/B harmony macro and the generative scene sequencer.

Basanta, A. (2017). Shades of synchresis: A proposed framework for the classification of audiovisual relations in sound-and-light media installations. *eContact!, 19*(2). https://econtact.ca/19_2/basanta_synchresis.html

↳ The OSC mapping rule: continuous sound to continuous image, discrete events to discrete events.

Boucher, M. (2021). *La vidéomusique comme matière en mouvement* [Videomusic as matter in motion] [Doctoral thesis, Université de Montréal]. Papyrus. http://hdl.handle.net/1866/26180

↳ The scene-tag schema (Diégèse, Synchrèse, Espace-temps, Climat), the Breathe axis, the Organic modulator and the Abstraction FX.

Boucher, M., & Piché, J. (2020). Sound/image relations in videomusic: A typological proposition. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 13–29). Routledge. https://doi.org/10.4324/9780429295102-2

↳ The synchresis coupling modes and the diegesis World presets.

Chion, M. (1994). *Audio-vision: Sound on screen* (C. Gorbman, Ed. & Trans.). Columbia University Press. (Original work published 1990)

↳ Synchresis, the root of the coupling modes and of the World (diegesis) mode.

Collopy, F. (2000). Color, form, and motion: Dimensions of a musical art of light. *Leonardo, 33*(5), 355–360. https://doi.org/10.1162/002409400552829

↳ The Vibe colour chords (harmony mode) and the Differential generator.

Collopy, F. (2020, May 15). *Visual synthesizer design: Where modern art was headed* [Unpublished manuscript]. Rhythmic Light. https://files.rhythmiclight.com/biblio/collopy2020.pdf

↳ The correspondence hypotheses behind the synesthetic OSC patch in `docs/research-ideas.md` (pitch to size, loudness to purity, timbre to hue).

Collopy, F., Fuhrer, R. M., & Jameson, D. (1999). Visual music in a visual programming language. In *Proceedings 1999 IEEE Symposium on Visual Languages* (pp. 111–118). IEEE. https://doi.org/10.1109/VL.1999.795882

↳ The where / when / what model of visual rhythm, noted for the trajectory modulator on the backlog (`docs/research-ideas.md`).

Cooke, G., & Wilcox, F. (2023). Audiovisual gesture and spectromorphology: The *Invalid Data W.E.S.T.* project. *International Journal of Performance Arts and Digital Media, 19*(2), 158–171. https://doi.org/10.1080/14794713.2022.2101317

↳ The aesthetic frame of the convolution nodes (gesture and energy transferred between media).

Coulter, J. (2010). Electroacoustic music with moving images: The art of media pairing. *Organised Sound, 15*(1), 26–34. https://doi.org/10.1017/S1355771809990239

↳ The media-pairing lineage behind the coupling engine and the A/B source pair.

Garro, D. (2012). From sonic art to visual music: Divergences, convergences, intersections. *Organised Sound, 17*(2), 103–113. https://doi.org/10.1017/S1355771812000027

↳ The aesthetic frame of the convolution nodes (sonic-art thinking applied to the image).

Garro, D. (2020). Connected media, connected idioms: The relationship between video and electroacoustic music from a composer's perspective. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 1–12). Routledge. https://doi.org/10.4324/9780429295102-1

↳ The Grain / Coalesce axis and the establish-then-articulate rule for couplings.

Gibson, S., Arisona, S., Leishman, D., & Tanaka, A. (Eds.). (2022). *Live visuals: History, theory, practice*. Routledge. https://doi.org/10.4324/9781003282396

↳ The instrument framing of Palinopsia (a played visual instrument, not a tool).

Harris, L. (2020). Exploring expanded audiovisual formats (EAFs): A practitioner's perspective. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 281–293). Routledge. https://doi.org/10.4324/9780429295102-19

↳ The Repose–Disturbance–Repose arc of the sequencer and its chaos-triggered step advance.

Hyde, J. (2020). The new analogue: Media archaeology as creative practice in 21st-century audiovisual art. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 188–205). Routledge. https://doi.org/10.4324/9780429295102-13

↳ The Decay FX (generation loss) and the media-archaeology register of the glitch family.

Knight-Hill, A. (2020). Audiovisual spaces: Spatiality, experience and potentiality in audiovisual composition. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 49–64). Routledge. https://doi.org/10.4324/9780429295102-4

↳ The Proximity macro and the Gesture / Texture motion character.

McDonnell, M. (2020). Constructing visual music images with electroacoustic music concepts. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 240–262). Routledge. https://doi.org/10.4324/9780429295102-17

↳ The Coalesce macro (grain to mass).

Pedersen, M., Burke, B., & Alsop, R. (2020). The spaces between gesture, sound and image. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 99–119). Routledge. https://doi.org/10.4324/9780429295102-7

↳ The Motion modulator's named archetypes and the coupling tightness dial.

Roads, C. (1996). *The computer music tutorial*. MIT Press.

↳ Convolution as cross-synthesis, the audio model the convolution nodes transpose to the image.

Rosa, H. (2019). *Resonance: A sociology of our relationship to the world* (J. C. Wagner, Trans.). Polity Press. (Original work published 2016)

↳ The vision return path (`engine/visionIn.ts`: the image can answer) and the Cameraless stage's hand-made "response".

Smalley, D. (1997). Spectromorphology: Explaining sound-shapes. *Organised Sound, 2*(2), 107–126. https://doi.org/10.1017/S1355771897009059

↳ The Motion modulator's archetypes and the Gesture / Texture axis.

Watkins, J. (2020). Visual music and embodied visceral affect. In A. Knight-Hill (Ed.), *Sound and image: Aesthetics and practices* (pp. 132–144). Routledge. https://doi.org/10.4324/9780429295102-9

↳ The affect-over-literal-mapping guardrail and the Rupture punctuation of the sequencer.

Wishart, T. (1996). *On sonic art* (S. Emmerson, Ed.; Rev. ed.). Harwood Academic Publishers.

↳ The convolution nodes (one signal imprinted on another) and the Cameraless grain and boil read as morphologies.

Wolff, F. (2015). *Pourquoi la musique ?* [Why music?]. Fayard.

↳ The design rule "expression over narration": meaning lies in how things move, not in what is shown.

## 14. Video feedback

Crutchfield, J. P. (1984). Space-time dynamics in video feedback. *Physica D: Nonlinear Phenomena, 10*(1–2), 229–245. https://doi.org/10.1016/0167-2789(84)90264-1

↳ The Feedback node (`node-feedback`): gain, zoom, rotation and delay as the controls that move the loop between fixed, periodic and chaotic regimes.

Langton, C. G. (1990). Computation at the edge of chaos: Phase transitions and emergent computation. *Physica D: Nonlinear Phenomena, 42*(1–3), 12–37. https://doi.org/10.1016/0167-2789(90)90064-V

↳ The edge-of-chaos target of the Feedback node's gain and AGC, and of the Homeostat modulator.

## 15. Projection and fulldome

Bourke, P. (2018). *Digital fulldome test pattern*. paulbourke.net. https://paulbourke.net/dome/testpattern/

↳ The alignment templates of the fulldome simulator that the Dome output and its preview were ported from (`shared/dome.ts`).

Fong, C. (2015). *Analytical methods for squaring the disc* (arXiv:1509.06344). arXiv. https://doi.org/10.48550/arXiv.1509.06344

↳ The elliptical-grid mapping that fills the whole 210° domemaster with the flat frame (`engine/dome.ts`).

## 16. Standards, protocols and open-source software

Feldstein, M. (n.d.). *interactive-shader-format-js* [Computer software, ISC License]. GitHub. https://github.com/msfeldstein/interactive-shader-format-js

↳ The ISF runtime (npm `interactive-shader-format`) that renders every ISF generator and FX.

FFmpeg Developers. (n.d.). *FFmpeg* [Computer software]. https://ffmpeg.org/

↳ Assemble's corpus analysis and export, and the video import cache.

International Telecommunication Union. (1992). *Information technology: Digital compression and coding of continuous-tone still images: Requirements and guidelines* (ITU-T Recommendation T.81). https://www.itu.int/rec/T-REC-T.81

↳ The 8×8 block, per-block quantisation and chroma-subsampling model of the Compress FX.

International Telecommunication Union. (2011). *Studio encoding parameters of digital television for standard 4:3 and wide screen 16:9 aspect ratios* (ITU-R Recommendation BT.601-7). https://www.itu.int/rec/R-REC-BT.601

↳ The luma weights (0.299, 0.587, 0.114) used by the native nodes.

International Telecommunication Union. (2015). *Parameter values for the HDTV standards for production and international programme exchange* (ITU-R Recommendation BT.709-6). https://www.itu.int/rec/R-REC-BT.709

↳ The video-range UYVY conversion of the frame-capture stage (`engine/frameCapture.ts`).

*ISF: Interactive Shader Format specification* (Version 2.0). (n.d.). GitHub. https://github.com/mrRay/ISF_Spec

↳ The shader format of the whole engine (JSON header plus GLSL, inputs, passes, persistent buffers).

*OSCQuery proposal* [Draft protocol specification]. (n.d.). GitHub. https://github.com/Vidvox/OSCQueryProposal

↳ The OSCQuery server that advertises the address space to any client.

Wright, M., & Freed, A. (1997). Open SoundControl: A new protocol for communicating with sound synthesizers. In *Proceedings of the 1997 International Computer Music Conference* (pp. 101–104). International Computer Music Association. https://opensoundcontrol.stanford.edu/files/1997-ICMC-OSC.pdf

↳ OSC in and out (`/opsia/...`), the link between Palinopsia and Pandore.

## 17. To verify

Entries above whose details could not all be confirmed against a primary source:

- Bayer (1973): the page numbering (26-11 to 26-15 in volume 1 of the ICC '73 Conference Record) comes from library indexes, not from the proceedings themselves.
- Sobel and Feldman (1968): the talk was never published; the title follows the form cited in later literature (first described in print by Duda and Hart, 1973, pp. 271–272).
- Tessendorf (2001): the notes circulate in several revisions (copyright 1999–2001, hosted copy revised later); the SIGGRAPH course number is not confirmed.
- Yeo and Berger (2006): the page range in the ICMC 2006 proceedings is not confirmed.
- Verplank, Mathews and Shaw (2000): pages 368–371 come from secondary citations; no stable URL for the paper was found.
- Mitsuhashi (1982): volume, issue and pages confirmed by secondary sources only; no DOI or stable URL checked.
- Mikkelsen (2022): the paper's own header prints "Vol. 11, No. 2" while the journal's official BibTeX gives issue 3 (used above, and matching the URL).
